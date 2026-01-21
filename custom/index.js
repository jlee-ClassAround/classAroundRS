// ===== [1] 설정 및 유틸리티 =====
const $ = (sel) => document.querySelector(sel);

let trackingFiles = []; // 기수별 데이터
let paymentRows = []; // 결제자 데이터

function toast(msg) {
    const t = $('#toast');
    if (!t) return;
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => t.classList.remove('show'), 2600);
}

// 번호 정규화
function normalizePhone(s) {
    if (!s) return '';
    let d = String(s).replace(/\D+/g, '');
    if (d.startsWith('82')) d = '0' + d.slice(2);
    if (d.length === 10 && d.startsWith('10')) d = '0' + d;
    return d.length >= 10 ? d : '';
}

// 금액 파싱 (환불 제외용 마이너스 인식, 쉼표 제거)
function parseAmount(v) {
    if (v === undefined || v === null || v === '') return 0;
    const clean = String(v).replace(/[^0-9.-]/g, '');
    const num = Math.floor(Number(clean));
    return isNaN(num) ? 0 : num;
}

// 견고한 CSV 파서
function robustCSVParser(text) {
    const out = [];
    let row = [],
        i = 0,
        q = false,
        field = '';
    while (i < text.length) {
        const c = text[i++];
        if (q) {
            if (c === '"') {
                if (text[i] === '"') {
                    field += '"';
                    i++;
                } else {
                    q = false;
                }
            } else {
                field += c;
            }
        } else {
            if (c === '"') {
                q = true;
            } else if (c === ',') {
                row.push(field);
                field = '';
            } else if (c === '\n' || c === '\r') {
                row.push(field);
                if (row.some((f) => f.trim() !== '')) out.push(row);
                row = [];
                field = '';
                if (c === '\r' && text[i] === '\n') i++;
            } else {
                field += c;
            }
        }
    }
    if (field !== '' || row.length) {
        row.push(field);
        out.push(row);
    }
    return out;
}

async function loadFileData(file) {
    if (!file) return [];
    if (file.name.endsWith('.xlsx') || file.name.endsWith('.xls')) {
        const ab = await file.arrayBuffer();
        const wb = XLSX.read(ab, { type: 'array' });
        return XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1 });
    }
    const ab = await file.arrayBuffer();
    const u8 = new Uint8Array(ab);
    let txt = new TextDecoder('utf-8').decode(u8);
    if (txt.includes('')) txt = new TextDecoder('euc-kr').decode(u8);
    return robustCSVParser(txt.replace(/^\uFEFF/, ''));
}

// ===== [2] UI 로직 =====
function addTrackingInput() {
    const id = Date.now();
    const div = document.createElement('div');
    div.className = 'paid-file-row';
    div.style =
        'display: flex; gap: 10px; margin-bottom: 10px; align-items: center; background: #f8f9fa; padding: 12px; border-radius: 8px;';
    div.innerHTML = `
        <input type="text" class="batch-name" value="${trackingFiles.length + 1}기" style="width: 60px; font-weight: bold;">
        <input type="file" class="batch-file" accept=".csv .xlsx">
        <button class="remove-btn" style="color: #ff4d4f; border: none; background: none; cursor: pointer; font-weight: bold;">삭제</button>
    `;

    div.querySelector('.batch-file').addEventListener('change', async (e) => {
        const data = await loadFileData(e.target.files[0]);
        const item = trackingFiles.find((t) => t.id === id);
        if (item) {
            item.data = data.slice(1);
            item.label = div.querySelector('.batch-name').value;
            toast(`${item.label} 로드 완료`);
        }
        updateStatus();
    });

    div.querySelector('.remove-btn').addEventListener('click', () => {
        div.remove();
        trackingFiles = trackingFiles.filter((t) => t.id !== id);
        updateStatus();
    });

    $('#paidFilesContainer').appendChild(div);
    trackingFiles.push({ id, data: [], label: `${trackingFiles.length + 1}기` });
}

function updateStatus() {
    const isReady = trackingFiles.some((t) => t.data.length > 0) && paymentRows.length > 0;
    $('#run').disabled = !isReady;
}

// ===== [3] 핵심 분석 로직 (기수별 잔여 금액 '기타' 처리) =====
function runAnalysis() {
    if (paymentRows.length === 0) return;

    // 1. 전체 결제자(환불 제외) 집계 -> 이것이 '전체 파이'가 됩니다.
    const validPayments = paymentRows
        .slice(1)
        .map((row) => ({
            phone: normalizePhone(row[4]),
            amount: parseAmount(row[14]),
        }))
        .filter((p) => p.amount > 0);

    const totalValidRevenue = validPayments.reduce((acc, cur) => acc + cur.amount, 0);
    const totalValidCount = validPayments.length;

    const reports = [];

    // 2. 각 기수별로 "전체 파이"를 어떻게 나눠가졌는지 분석
    trackingFiles.forEach((batch) => {
        const batchName = batch.label;
        const batchMap = new Map();

        // (A) 통계 객체 초기화 - '기타' 미리 생성
        const stats = {
            label: batchName,
            matchedAmount: 0,
            matchedCount: 0,
            sources: {
                // 트래킹 파일에 있는 소스들이 들어갈 곳
            },
            // 이 기수 명단에 없는 나머지 전부
            other: {
                label: '기타 (기수 내 미매칭)',
                count: 0,
                amount: 0,
            },
        };

        // (B) 전화번호부 생성
        batch.data.forEach((row) => {
            const phone = normalizePhone(row[6]);
            const source = String(row[3] || '유입경로 미기재').trim();

            // 소스 목록 등록 (모수 카운트용)
            if (!stats.sources[source]) {
                stats.sources[source] = { payCount: 0, payAmount: 0, trackCount: 0 };
            }
            stats.sources[source].trackCount++;

            if (phone) {
                // 중복 시 기존 것 유지 (또는 덮어쓰기 정책에 따라 변경 가능)
                if (!batchMap.has(phone)) batchMap.set(phone, source);
            }
        });

        // (C) 결제자 전수 조사: 매칭 vs 비매칭(기타)
        validPayments.forEach((pay) => {
            if (pay.phone && batchMap.has(pay.phone)) {
                // [매칭] 이 기수 명단에 있음
                const source = batchMap.get(pay.phone);

                // (이론상 존재해야 함)
                if (!stats.sources[source]) {
                    stats.sources[source] = { payCount: 0, payAmount: 0, trackCount: 0 };
                }

                stats.sources[source].payCount++;
                stats.sources[source].payAmount += pay.amount;

                stats.matchedCount++;
                stats.matchedAmount += pay.amount;
            } else {
                // [비매칭] 이 기수 명단에 없음 -> 전부 이 기수의 '기타'로 들어감
                // (다른 기수에 있든 말든 상관없음. 이 기수 입장에서는 '기타'임)
                stats.other.count++;
                stats.other.amount += pay.amount;
            }
        });

        reports.push(stats);
    });

    displayReport(reports, totalValidRevenue, totalValidCount);
}

// ===== [4] 결과 출력 =====
function displayReport(reports, grandTotal, totalCount) {
    let html = `<h2 style="margin: 40px 0 20px;">📊 분석 리포트 (총 실매출: ${grandTotal.toLocaleString()}원)</h2>`;

    reports.forEach((batch) => {
        // 합계 검증 (매칭 + 기타 = 전체)
        const batchTotal = batch.matchedAmount + batch.other.amount;

        html += `
        <div style="background: #fff; border: 1px solid #ddd; border-radius: 12px; padding: 20px; margin-bottom: 30px; box-shadow: 0 4px 6px rgba(0,0,0,0.05);">
            <h3 style="margin-top:0; color: #1a73e8; border-bottom: 2px solid #e8f0fe; padding-bottom: 10px;">
                📍 ${batch.label} 현황
                <span style="font-size:0.8em; color:#555; float:right; font-weight:normal;">
                    분석 대상 총액: <strong>${batchTotal.toLocaleString()}원</strong>
                </span>
            </h3>
            
            <table style="width: 100%; border-collapse: collapse; margin-top: 15px;">
                <thead>
                    <tr style="background: #f8f9fa; border-bottom: 2px solid #dee2e6;">
                        <th style="padding: 10px; text-align: left;">유입 경로</th>
                        <th style="padding: 10px; text-align: right;">결제 / 트래킹</th>
                        <th style="padding: 10px; text-align: right;">전환율</th>
                        <th style="padding: 10px; text-align: right;">결제 금액</th>
                        <th style="padding: 10px; text-align: right;">비중</th>
                    </tr>
                </thead>
                <tbody>`;

        // 1. 매칭된 소스들 출력
        const sortedSources = Object.entries(batch.sources).sort(
            (a, b) => b[1].payAmount - a[1].payAmount
        );

        sortedSources.forEach(([source, data]) => {
            // 매출도 없고 트래킹 모수도 없으면 생략 가능 (사용자 취향에 따라 주석 해제)
            // if (data.payCount === 0 && data.trackCount === 0) return;

            const convRate =
                data.trackCount > 0 ? ((data.payCount / data.trackCount) * 100).toFixed(1) : '0.0';
            const portion =
                grandTotal > 0 ? ((data.payAmount / grandTotal) * 100).toFixed(1) : '0.0';
            const amountStyle =
                data.payAmount === 0 ? 'color: #aaa;' : 'font-weight: bold; color: #333;';

            html += `
            <tr style="border-bottom: 1px solid #eee;">
                <td style="padding: 10px;">${source}</td>
                <td style="padding: 10px; text-align: right;">${data.payCount.toLocaleString()} / ${data.trackCount.toLocaleString()}</td>
                <td style="padding: 10px; text-align: right;">${convRate}%</td>
                <td style="padding: 10px; text-align: right; ${amountStyle}">${data.payAmount.toLocaleString()}원</td>
                <td style="padding: 10px; text-align: right; color: #666;">${portion}%</td>
            </tr>`;
        });

        // 2. 이 기수의 '기타' (미매칭 잔여분) 출력
        // 이 항목은 트래킹 모수라는 개념이 없으므로 '-' 처리
        const otherPortion =
            grandTotal > 0 ? ((batch.other.amount / grandTotal) * 100).toFixed(1) : '0.0';

        html += `
            <tr style="border-bottom: 1px solid #eee; background-color: #fff9f9;">
                <td style="padding: 10px; color: #d32f2f; font-weight: bold;">기타 (미매칭)</td>
                <td style="padding: 10px; text-align: right;">${batch.other.count.toLocaleString()} / -</td>
                <td style="padding: 10px; text-align: right;">-</td>
                <td style="padding: 10px; text-align: right; font-weight: bold; color: #d32f2f;">${batch.other.amount.toLocaleString()}원</td>
                <td style="padding: 10px; text-align: right; color: #d32f2f;">${otherPortion}%</td>
            </tr>
        `;

        html += `</tbody></table></div>`;
    });

    $('.stat').innerHTML = html;
    text('#stat', '분석 완료');
    $('#dlCsv').disabled = false;
}

function text(sel, v) {
    $(sel).textContent = v;
}

// ===== [5] 바인딩 =====
$('#addPaidFileBtn').addEventListener('click', addTrackingInput);
$('#free').addEventListener('change', async (e) => {
    paymentRows = await loadFileData(e.target.files[0]);
    toast('결제자 파일 로드 완료');
    updateStatus();
});
$('#run').addEventListener('click', runAnalysis);
$('#reset').addEventListener('click', () => location.reload());

addTrackingInput();
