// ===== 유틸리티 =====
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
    const delims = [',', ';', '\t'];
    let delim = ',';
    const lines = text.split(/\r?\n/).slice(0, 3);
    let best = -1;
    for (const d of delims) {
        const s = lines.map((l) => l.split(d).length).reduce((a, b) => a + b, 0);
        if (s > best) {
            best = s;
            delim = d;
        }
    }
    const out = [];
    let row = [];
    let i = 0;
    let q = false;
    let field = '';
    while (i < text.length) {
        const c = text[i++];
        if (q) {
            if (c === '"') {
                if (text[i] === '"') {
                    field += '"';
                    i++;
                } else q = false;
            } else field += c;
        } else {
            if (c === '"') q = true;
            else if (c === delim) {
                row.push(field);
                field = '';
            } else if (c === '\n') {
                row.push(field);
                out.push(row);
                row = [];
                field = '';
            } else if (c === '\r') {
            } else field += c;
        }
    }
    if (field !== '' || row.length) {
        row.push(field);
        out.push(row);
    }
    return out.filter((r) => r.some((c) => String(c).trim() !== ''));
}

function convertToInt(v) {
    return Number(String(v ?? '').replace(/[₩$,,\s]/g, '')) || 0;
}

// ===== 상태 관리 =====
let paidFiles = []; // { id, rows: [], label: '1기' }
let freeRows = [];
let resultSummary = []; // CSV용 요약 데이터 저장

function createPaidFileInput() {
    const id = Date.now();
    const div = document.createElement('div');
    div.className = 'paid-file-row';
    div.id = `paid-row-${id}`;
    div.innerHTML = `<input type="text" class="paid-label" value="${
        paidFiles.length + 1
    }기"><input type="file" class="paid-file" accept=".csv .xlsx"><button class="remove-paid-btn">삭제</button>`;

    div.querySelector('.paid-file').addEventListener('change', async (e) => {
        const f = e.target.files?.[0];
        if (!f) return;
        const rows = await readFileData(f);
        const item = paidFiles.find((p) => p.id === id);
        if (item) item.rows = rows.slice(1);
        toast(`${f.name} 로드 완료`);
        refresh();
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
    const hasPaid = paidFiles.some((p) => p.rows.length > 0);
    $('#run').disabled = !(hasPaid && freeRows.length > 0);
}

// ===== 👑 분석 실행 (기수별 + 유입경로별) =====
function runMatch() {
    const summaryData = [];
    const paidMap = new Map(); // phone -> { batch, source }

    // 1. 코어데브 기수별 세부 유입경로 데이터 구축
    const batchStats = paidFiles
        .filter((p) => p.rows.length > 0)
        .map((file) => {
            const sources = new Map(); // sourceName -> { totalInSource, matchedInSource, amountInSource }

            file.rows.forEach((r) => {
                const phone = normalizeDigits(r[6]); // G열
                const source = String(r[3] || '기타').trim(); // D열

                if (phone) {
                    if (!paidMap.has(phone)) {
                        paidMap.set(phone, { batchLabel: file.label, source: source });
                    }

                    // 유입경로별 인원수 집계
                    if (!sources.has(source))
                        sources.set(source, { total: 0, matched: 0, amount: 0 });
                    sources.get(source).total++;
                }
            });
            return { label: file.label, sources: sources };
        });

    let totalMatched = 0;
    let grandTotalSales = 0;

    // 2. 결제자 데이터 대조
    freeRows.forEach((r) => {
        const p = normalizeDigits(r[4]); // E열
        const amount = convertToInt(r[14]); // O열
        if (amount <= 0) return;

        const match = p ? paidMap.get(p) : null;
        if (match) {
            totalMatched++;
            grandTotalSales += amount;

            // 해당 기수의 해당 유입경로에 데이터 누적
            const batch = batchStats.find((b) => b.label === match.batchLabel);
            const sourceStat = batch.sources.get(match.source);
            if (sourceStat) {
                sourceStat.matched++;
                sourceStat.amount += amount;
            }
        }
    });

    renderSummary(batchStats, grandTotalSales);

    $('#dlCsv').disabled = false;
    $('#dlXls').disabled = false;
    $('#stat').textContent = `분석 완료: 총 ${totalMatched}건 매칭`;
}

function renderSummary(batchStats, grandTotalSales) {
    let html = `<h3>📊 상세 검수 리포트 (기수별 유입경로)</h3>
    <table><thead><tr>
        <th>기수</th><th>유입경로</th><th>매칭 / 트래킹</th><th>전환율</th><th>결제액 합계</th><th>매출 비중</th>
    </tr></thead><tbody>`;

    const csvRows = [
        ['기수', '유입경로', '매칭건수', '트래킹인원', '전환율', '결제금액', '매출비중'],
    ];

    batchStats.forEach((batch) => {
        // 기수별 헤더 행
        html += `<tr class="group-header"><td colspan="6">${batch.label} 전체 성과</td></tr>`;

        // 유입경로별 정렬 (결제액 순)
        const sortedSources = Array.from(batch.sources.entries()).sort(
            (a, b) => b[1].amount - a[1].amount
        );

        sortedSources.forEach(([sourceName, data]) => {
            const rate = data.total > 0 ? ((data.matched / data.total) * 100).toFixed(1) : '0.0';
            const portion =
                grandTotalSales > 0 ? ((data.amount / grandTotalSales) * 100).toFixed(1) : '0.0';

            html += `<tr>
                <td>${batch.label}</td>
                <td>${sourceName}</td>
                <td>${data.matched} / ${data.total}</td>
                <td>${rate}%</td>
                <td>${data.amount.toLocaleString()}원</td>
                <td>${portion}%</td>
            </tr>`;

            csvRows.push([
                batch.label,
                sourceName,
                data.matched,
                data.total,
                `${rate}%`,
                data.amount,
                `${portion}%`,
            ]);
        });
    });

    html += `<tr class="total-row"><td colspan="4">합계</td><td colspan="2">${grandTotalSales.toLocaleString()}원</td></tr></tbody></table>`;
    $('.stat').innerHTML = html;
    resultSummary = csvRows;
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
    const csv = '\uFEFF' + resultSummary.map((r) => r.join(',')).join('\n');
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
    a.href = URL.createObjectURL(new Blob([html], { type: 'application/vnd.ms-excel' }));
    a.download = $('#fname').value + '.xls';
    a.click();
});
$('#reset').addEventListener('click', () => location.reload());
createPaidFileInput();
