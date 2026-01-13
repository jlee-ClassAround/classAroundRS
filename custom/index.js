const $ = (sel) => document.querySelector(sel);
function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => t.classList.remove('show'), 2600);
}

function normalizeDigits(s) {
    let d = String(s ?? '').replace(/\D+/g, '');
    if (!d) return '';
    if (d.startsWith('82')) d = '0' + d.slice(2);
    if (d.length === 10 && d.startsWith('10')) d = '0' + d;
    if (d.length > 11) d = d.slice(-11);
    return /^01\d{8,9}$/.test(d) ? d : '';
}

function parseCSV(text) {
    const rows = [];
    let row = [];
    let field = '';
    let q = false;
    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (q) {
            if (c === '"' && text[i + 1] === '"') {
                field += '"';
                i++;
            } else if (c === '"') q = false;
            else field += c;
        } else {
            if (c === '"') q = true;
            else if (c === ',') {
                row.push(field);
                field = '';
            } else if (c === '\n' || c === '\r') {
                if (field || row.length) {
                    row.push(field);
                    rows.push(row);
                    row = [];
                    field = '';
                }
            } else field += c;
        }
    }
    if (field || row.length) {
        row.push(field);
        rows.push(row);
    }
    return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

function convertToInt(v) {
    return Number(String(v ?? '').replace(/[₩$,,\s]/g, '')) || 0;
}

let paidFiles = [];
let freeRows = [];
let resultSummaryRows = [];

function createPaidFileInput() {
    const id = Date.now();
    const div = document.createElement('div');
    div.className = 'paid-file-row';
    div.id = `paid-row-${id}`;
    div.innerHTML = `<input type="text" class="paid-label" value="${
        paidFiles.length + 1
    }기"><input type="file" class="paid-file" accept=".csv .xlsx"><button class="remove-paid-btn">삭제</button>`;

    div.querySelector('.paid-file').addEventListener('change', async (e) => {
        const rows = await readFileData(e.target.files[0]);
        const item = paidFiles.find((p) => p.id === id);
        if (item) item.rows = rows.slice(1);
        toast('파일 로드 완료');
        refresh();
    });
    div.querySelector('.paid-label').addEventListener('input', (e) => {
        const item = paidFiles.find((p) => p.id === id);
        if (item) item.label = e.target.value;
    });
    div.querySelector('.remove-paid-btn').addEventListener('click', () => {
        div.remove();
        paidFiles = paidFiles.filter((p) => p.id !== id);
        refresh();
    });
    $('#paidFilesContainer').appendChild(div);
    paidFiles.push({ id, rows: [], label: `${paidFiles.length + 1}기` });
}

async function readFileData(f) {
    if (!f) return [];
    if (f.name.endsWith('.xlsx') || f.name.endsWith('.xls')) {
        const ab = await f.arrayBuffer();
        const wb = XLSX.read(ab, { type: 'array' });
        return XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1 });
    } else {
        const ab = await f.arrayBuffer();
        const u8 = new Uint8Array(ab);
        let txt = new TextDecoder('utf-8').decode(u8);
        if (!txt.includes(',')) txt = new TextDecoder('euc-kr').decode(u8);
        return parseCSV(txt.replace(/^\uFEFF/, ''));
    }
}

function refresh() {
    $('#run').disabled = !(paidFiles.some((p) => p.rows.length > 0) && freeRows.length > 0);
}

// ===== 👑 분석 실행 (기수별 기타 배분 로직) =====
function runMatch() {
    const paidMap = new Map(); // phone -> { batchLabel, source }
    const batchPeriods = new Map(); // batchLabel -> { minDate, maxDate }

    // 1. 기수별 트래킹 맵 구성
    const batchStats = paidFiles
        .filter((p) => p.rows.length > 0)
        .map((file) => {
            const sources = new Map();
            file.rows.forEach((r) => {
                const phone = normalizeDigits(r[6]); // G열
                const source = String(r[3] || '기타').trim(); // D열
                if (phone) {
                    if (!paidMap.has(phone))
                        paidMap.set(phone, { batchLabel: file.label, source: source });
                    if (!sources.has(source))
                        sources.set(source, { total: 0, matched: 0, amount: 0 });
                    sources.get(source).total++;
                }
            });
            return { label: file.label, sources: sources, otherCount: 0, otherAmount: 0 };
        });

    // 2. 결제자 대조 및 기수 기간 자동 감지
    const tempPayments = [];
    freeRows.forEach((r) => {
        const payDate = new Date(r[0]).getTime(); // A열 결제일자
        const p = normalizeDigits(r[4]); // E열 전화번호
        const amount = convertToInt(r[14]); // O열 금액
        if (amount <= 0 || isNaN(payDate)) return;

        const match = p ? paidMap.get(p) : null;
        if (match) {
            // 기수 기간 업데이트
            const period = batchPeriods.get(match.batchLabel) || { min: Infinity, max: -Infinity };
            batchPeriods.set(match.batchLabel, {
                min: Math.min(period.min, payDate),
                max: Math.max(period.max, payDate),
            });
        }
        tempPayments.push({ date: payDate, phone: p, amount, match });
    });

    let grandTotalSales = 0;

    // 3. 데이터 집계 (매칭 vs 자동 배분 기타)
    tempPayments.forEach((pay) => {
        grandTotalSales += pay.amount;

        if (pay.match) {
            // 번호 매칭 성공 시
            const batch = batchStats.find((b) => b.label === pay.match.batchLabel);
            const sourceStat = batch.sources.get(pay.match.source);
            if (sourceStat) {
                sourceStat.matched++;
                sourceStat.amount += pay.amount;
            }
        } else {
            // 번호 매칭 실패 -> 날짜 기반으로 해당 기수 '기타'로 배정
            let assignedBatch = null;
            for (const [label, range] of batchPeriods.entries()) {
                if (pay.date >= range.min && pay.date <= range.max) {
                    assignedBatch = batchStats.find((b) => b.label === label);
                    break;
                }
            }

            if (assignedBatch) {
                assignedBatch.otherCount++;
                assignedBatch.otherAmount += pay.amount;
            } else {
                // 어떤 기간에도 해당 안 되면 리스트의 마지막 기수에 배정하거나 별도 처리 (여기서는 마지막 기수 가정)
                const lastBatch = batchStats[batchStats.length - 1];
                lastBatch.otherCount++;
                lastBatch.otherAmount += pay.amount;
            }
        }
    });

    renderSummary(batchStats, grandTotalSales);
    $('#dlCsv').disabled = false;
    $('#dlXls').disabled = false;
    $('#stat').textContent = `분석 완료: 총 결제액 ${grandTotalSales.toLocaleString()}원`;
}

function renderSummary(batchStats, grandTotal) {
    let html = `<h3>📊 상세 성과 리포트 (기수별 기타 포함)</h3>
    <table><thead><tr>
        <th>기수</th><th>유입경로</th><th>매칭 / 트래킹</th><th>전환율</th><th>결제금액</th><th>매출 비중</th>
    </tr></thead><tbody>`;

    const csvRows = [
        ['기수', '유입경로', '매칭건수', '트래킹인원', '전환율', '결제금액', '매출비중'],
    ];

    batchStats.forEach((batch) => {
        html += `<tr class="group-header"><td colspan="6">${batch.label} 상세 성과</td></tr>`;

        let bMatched = 0;
        let bTracking = 0;
        let bAmount = 0;
        const sorted = Array.from(batch.sources.entries()).sort(
            (a, b) => b[1].amount - a[1].amount
        );

        // 1. 광고 유입 성과
        sorted.forEach(([source, data]) => {
            const rate = data.total > 0 ? ((data.matched / data.total) * 100).toFixed(1) : '0.0';
            const portion = grandTotal > 0 ? ((data.amount / grandTotal) * 100).toFixed(1) : '0.0';
            html += `<tr><td>${batch.label}</td><td>${source}</td><td>${data.matched} / ${
                data.total
            }</td><td>${rate}%</td><td>${data.amount.toLocaleString()}원</td><td>${portion}%</td></tr>`;
            csvRows.push([
                batch.label,
                source,
                data.matched,
                data.total,
                `${rate}%`,
                data.amount,
                `${portion}%`,
            ]);
            bMatched += data.matched;
            bTracking += data.total;
            bAmount += data.amount;
        });

        // 2. ✅ 해당 기수 기간 내 '기타(기존회원)' 배분 결과
        const otherPortion =
            grandTotal > 0 ? ((batch.otherAmount / grandTotal) * 100).toFixed(1) : '0.0';
        html += `<tr class="batch-other-row"><td>${batch.label}</td><td>기타(기존회원)</td><td>${
            batch.otherCount
        } / -</td><td>-</td><td>${batch.otherAmount.toLocaleString()}원</td><td>${otherPortion}%</td></tr>`;
        csvRows.push([
            batch.label,
            '기타(기존회원)',
            batch.otherCount,
            0,
            '-',
            batch.otherAmount,
            `${otherPortion}%`,
        ]);

        // 3. 기수별 전체 성과 (소계)
        const totalBMatched = bMatched + batch.otherCount;
        const totalBAmount = bAmount + batch.otherAmount;
        const bRate = bTracking > 0 ? ((bMatched / bTracking) * 100).toFixed(1) : '0.0';
        const bPortion = grandTotal > 0 ? ((totalBAmount / grandTotal) * 100).toFixed(1) : '0.0';

        html += `<tr class="subtotal-row"><td>${
            batch.label
        } 전체</td><td>기수 소계</td><td>${totalBMatched} / ${bTracking}</td><td>${bRate}%</td><td>${totalBAmount.toLocaleString()}원</td><td>${bPortion}%</td></tr>`;
        csvRows.push([
            batch.label,
            '기수소계',
            totalBMatched,
            bTracking,
            `${bRate}%`,
            totalBAmount,
            `${bPortion}%`,
        ]);
    });

    html += `<tr class="total-row"><td colspan="4">전체 매출 합계</td><td colspan="2">${grandTotal.toLocaleString()}원</td></tr></tbody></table>`;
    $('.stat').innerHTML = html;
    resultSummaryRows = csvRows;
}

// 이벤트 바인딩
$('#addPaidFileBtn').addEventListener('click', createPaidFileInput);
$('#free').addEventListener('change', async (e) => {
    freeRows = await readFileData(e.target.files[0]);
    toast('결제자 파일 로드 완료');
    refresh();
});
$('#run').addEventListener('click', runMatch);
$('#dlCsv').addEventListener('click', () => {
    const csv = '\uFEFF' + resultSummaryRows.map((r) => r.join(',')).join('\n');
    const b = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(b);
    a.download = $('#fname').value + '.csv';
    a.click();
});
$('#dlXls').addEventListener('click', () => {
    const html = `<html><head><meta charset="UTF-8"></head><body>${
        $('.stat').innerHTML
    }</body></html>`;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['\uFEFF' + html], { type: 'application/vnd.ms-excel' }));
    a.download = $('#fname').value + '.xls';
    a.click();
});
$('#reset').addEventListener('click', () => location.reload());
createPaidFileInput();
