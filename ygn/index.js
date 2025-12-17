// =========================
// DOM Utils
// =========================
const $ = (sel) => document.querySelector(sel);
const text = (sel, v) => {
    const el = $(sel);
    if (el) el.textContent = v;
};

function toast(msg) {
    const t = $('#toast');
    if (!t) return;
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => t.classList.remove('show'), 2600);
}

// =========================
// File Read Utils
// =========================
function readAsArrayBuffer(file) {
    return new Promise((res, rej) => {
        const fr = new FileReader();
        fr.onload = (e) => res(e.target.result);
        fr.onerror = rej;
        fr.readAsArrayBuffer(file);
    });
}

async function readCsvText(file) {
    const ab = await readAsArrayBuffer(file);
    const u8 = new Uint8Array(ab);

    let txt = new TextDecoder('utf-8', { fatal: false }).decode(u8);
    if (/�/.test(txt)) {
        try {
            const alt = new TextDecoder('euc-kr').decode(u8);
            if (!/�/.test(alt)) txt = alt;
        } catch (_) {}
    }
    return txt.replace(/^\uFEFF/, '');
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
                } else {
                    q = false;
                }
            } else {
                field += c;
            }
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
                // ignore
            } else {
                field += c;
            }
        }
    }

    if (field !== '' || row.length) {
        row.push(field);
        out.push(row);
    }

    return out.filter((r) => r.some((c) => String(c).trim() !== ''));
}

function isNonEmptyRow(r) {
    return Array.isArray(r) && r.some((c) => String(c ?? '').trim() !== '');
}

// =========================
// Normalizers
// =========================
function moneyToNumber(v) {
    if (v == null) return 0;
    if (typeof v === 'number') return Number.isFinite(v) ? v : 0;

    const s = String(v).trim();
    if (!s) return 0;

    // ₩, commas, spaces, etc 제거
    const num = s.replace(/[^\d.-]/g, '');
    const n = Number(num);
    return Number.isFinite(n) ? n : 0;
}

// ✅ 전화번호 정규화 (하이픈/공백 제거 + 82 처리 + 엑셀 앞0 누락 보정)
function normalizeDigits(s) {
    let d = String(s ?? '').replace(/\D+/g, '');
    if (!d) return '';

    // 82로 시작하면 국내형 0으로 변환
    if (d.startsWith('82')) d = '0' + d.slice(2);

    // ✅ 엑셀 숫자형으로 0이 날아간 케이스 보정
    // 010xxxxxxxx -> 10xxxxxxxxx(10자리)로 들어오는 경우가 많음
    if (d.length === 10 && d.startsWith('1')) d = '0' + d;

    // 이상하게 길면 뒤 11자리
    if (d.length > 11) d = d.slice(-11);

    // 휴대폰 형태만 통과(01 + 10~11자리)
    if (!/^01\d{8,9}$/.test(d)) return '';

    return d;
}

// =========================
// State
// =========================
// paid: 결제금액 파일(1번 업로드)
// free: 신청자 파일(2번 업로드)
let paidBody = [];
let freeBody = [];
let resultRows = [];

// =========================
// Render / Download
// =========================
function render(rows) {
    const wrap = $('#tableWrap');
    if (!wrap) return;

    if (!rows || rows.length === 0) {
        wrap.innerHTML = '';
        return;
    }

    const [h, ...b] = rows;
    const thead = '<thead><tr>' + h.map((x) => `<th>${x}</th>`).join('') + '</tr></thead>';
    const tbody =
        '<tbody>' +
        b.map((r) => '<tr>' + r.map((c) => `<td>${c ?? ''}</td>`).join('') + '</tr>').join('') +
        '</tbody>';

    wrap.innerHTML = '<table>' + thead + tbody + '</table>';
}

function toCSV(rows) {
    return rows
        .map((r) =>
            r
                .map((v) => {
                    const s = String(v ?? '');
                    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
                })
                .join(',')
        )
        .join('\n');
}

function downloadBlob(name, blob) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function getBaseName() {
    let n = ($('#fname')?.value || '').trim();
    if (!n) n = 'matched';
    return n;
}

// CSV(UTF-8+BOM) 다운로드: 전화번호 텍스트 유지
function downloadCSV() {
    if (resultRows.length <= 1) return;

    const safe = resultRows.map((r, i) => {
        if (i === 0) return r;
        // 연락처 텍스트 강제(엑셀 앞0 보존)
        return [r[0], "'" + (r[1] ?? ''), r[2]];
    });

    const csv = toCSV(safe);
    const bom = '\uFEFF';
    downloadBlob(getBaseName() + '.csv', new Blob([bom, csv], { type: 'text/csv;charset=utf-8' }));
}

// Excel(.xls) 다운로드: 전화번호 텍스트 서식
function downloadXLS() {
    if (resultRows.length <= 1) return;

    const [h, ...b] = resultRows;
    const esc = (s) =>
        String(s ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');

    const head = '<tr>' + h.map((x) => `<th>${esc(x)}</th>`).join('') + '</tr>';
    const body = b
        .map(
            (r) =>
                '<tr>' +
                `<td>${esc(r[0])}</td>` +
                `<td style="mso-number-format:'\\@'">${esc(r[1])}</td>` +
                `<td>${esc(r[2])}</td>` +
                '</tr>'
        )
        .join('');

    const html =
        `<!doctype html><html><head><meta charset="UTF-8"><title>${esc(
            getBaseName()
        )}</title></head>` + `<body><table border="1">${head}${body}</table></body></html>`;

    downloadBlob(getBaseName() + '.xls', new Blob([html], { type: 'application/vnd.ms-excel' }));
}

// =========================
// File Input Handler
// =========================
async function onFile(e) {
    const id = e.target.id; // paid / free
    const f = e.target.files?.[0];

    if (!f) {
        if (id === 'paid') paidBody = [];
        if (id === 'free') freeBody = [];
        refresh();
        return;
    }

    text('#stat', `${f.name} 읽는 중…`);

    try {
        let rows = [];

        // XLSX/XLS
        if (f.name.endsWith('.xlsx') || f.name.endsWith('.xls')) {
            const ab = await readAsArrayBuffer(f);
            const wb = XLSX.read(ab, { type: 'array' });
            const ws = wb.Sheets[wb.SheetNames[0]];
            rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' }).filter(isNonEmptyRow);
        } else {
            // CSV
            const txt = await readCsvText(f);
            rows = parseCSV(txt).filter(isNonEmptyRow);
        }

        // 1행(헤더) 제거하고 body만 저장
        const body = rows.slice(1);

        if (id === 'paid') paidBody = body;
        if (id === 'free') freeBody = body;

        console.log('[LOAD]', id, f.name, 'rows:', body.length);
        text('#stat', '파일 로드 완료');
        toast(`${f.name} 불러오기 성공 (${body.length}행)`);
    } catch (err) {
        console.error(err);
        alert('파일 읽기 오류: ' + (err.message || err));
        text('#stat', '오류');
    }

    refresh();
}

function refresh() {
    const hasFiles = paidBody.length > 0 && freeBody.length > 0;
    $('#run').disabled = !hasFiles;
}

// =========================
// ✅ 핵심: 매칭 실행
// =========================
function runMatch() {
    // =========================
    // 신청자 파일(2번째 파일): B=1 이름, C=2 연락처
    // =========================
    const FREE_NAME_IDX = 1; // B
    const FREE_PHONE_IDX = 2; // C

    // =========================
    // 결제금액 파일(1번째 파일) 케이스 2개 지원
    // 1) XLSX 케이스: E=4 전화번호, O=14 최종금액
    // 2) CSV  케이스: N=13 전화번호, AI=34 결제금액
    // =========================
    const PAID_LAYOUTS = [
        { name: 'XLSX(E/O)', phoneIdx: 4, amountIdx: 14 }, // E, O
        { name: 'CSV(N/AI)', phoneIdx: 13, amountIdx: 34 }, // N, AI  (A=0 기준)
    ];

    if (!paidBody?.length) return alert('결제금액 파일이 비어있어요.');
    if (!freeBody?.length) return alert('신청자 파일이 비어있어요.');

    // 1) 결제자 Map: phone -> sum
    const paidSumMap = new Map(); // normPhone -> number(sum)

    // 레이아웃별로 실제로 얼마나 잡혔는지 카운트(디버깅용)
    const layoutHit = Object.fromEntries(PAID_LAYOUTS.map((x) => [x.name, 0]));
    let paidRowsScanned = 0;

    for (const r of paidBody) {
        if (!Array.isArray(r)) continue;
        paidRowsScanned++;

        let matchedLayoutName = null;
        let phone = '';
        let amt = 0;

        // ✅ 각 row마다: (E/O 먼저) → 실패하면 (N/AI) 시도
        for (const layout of PAID_LAYOUTS) {
            const rawPhone = r[layout.phoneIdx];
            const rawAmt = r[layout.amountIdx];

            const p = normalizeDigits(rawPhone);
            if (!p) continue;

            const a = moneyToNumber(rawAmt);
            if (a <= 0) continue;

            phone = p;
            amt = a;
            matchedLayoutName = layout.name;
            break;
        }

        if (!matchedLayoutName) continue;

        layoutHit[matchedLayoutName] += 1;
        paidSumMap.set(phone, (paidSumMap.get(phone) || 0) + amt);
    }

    // 2) 신청자 기준 결과: 매칭된 것만 출력
    const out = [['이름', '연락처', '결제금액']];

    let matchedCount = 0;
    let totalAmount = 0;

    for (const r of freeBody) {
        if (!Array.isArray(r)) continue;

        const name = String(r[FREE_NAME_IDX] ?? '').trim();
        const rawPhone = String(r[FREE_PHONE_IDX] ?? '').trim();
        const phone = normalizeDigits(rawPhone);

        const sum = phone ? paidSumMap.get(phone) || 0 : 0;

        // ✅ 매칭된 것만 출력
        if (sum > 0) {
            matchedCount++;
            totalAmount += sum;
            out.push([name, rawPhone, sum]);
        }
    }

    resultRows = out;
    render(out);

    // 3) 요약 표시
    const statDiv = document.querySelector('.stat');
    if (statDiv) {
        statDiv.innerHTML = `
      <div style="padding:10px; background:#eef6ff; border:1px solid #cfe5ff; border-radius:10px; margin-bottom:12px;">
        <b>매칭 조건</b><br/>
        신청자 파일: 이름(B=1), 연락처(C=2)<br/>
        결제금액 파일: XLSX(E=4,O=14) 또는 CSV(N=13,AI=34) 자동 대응<br/><br/>
        결제자 스캔 행수: <b>${paidRowsScanned.toLocaleString()}</b><br/>
        결제자 유니크 번호 수: <b>${paidSumMap.size.toLocaleString()}</b><br/>
        레이아웃별 적중: 
        <b>XLSX(E/O) ${layoutHit['XLSX(E/O)'].toLocaleString()}</b> / 
        <b>CSV(N/AI) ${layoutHit['CSV(N/AI)'].toLocaleString()}</b>
      </div>

      <h3 style="margin:10px 0;">요약</h3>
      <p style="margin:6px 0;">매칭 건수: <b>${matchedCount.toLocaleString()}</b>건</p>
      <p style="margin:6px 0;">총 결제금액 합계: <b>₩${totalAmount.toLocaleString()}</b></p>
    `;
    }

    const has = out.length > 1;
    $('#dlCsv').disabled = !has;
    $('#dlXls').disabled = !has;

    text('#stat', `완료: ${matchedCount}건 / ₩${totalAmount.toLocaleString()}`);
    toast(`완료: ${matchedCount}건 매칭`);
}

// =========================
// Reset
// =========================
function resetAll() {
    paidBody = [];
    freeBody = [];
    resultRows = [];

    $('#paid').value = '';
    $('#free').value = '';
    $('#run').disabled = true;
    $('#dlCsv').disabled = true;
    $('#dlXls').disabled = true;

    const wrap = $('#tableWrap');
    if (wrap) wrap.innerHTML = '';

    const statDiv = document.querySelector('.stat');
    if (statDiv) statDiv.innerHTML = '';

    text('#stat', '대기 중');
    toast('초기화 완료');
    refresh();
}

// =========================
// Bind
// =========================
$('#paid').addEventListener('change', onFile);
$('#free').addEventListener('change', onFile);
$('#run').addEventListener('click', runMatch);
$('#dlCsv').addEventListener('click', downloadCSV);
$('#dlXls').addEventListener('click', downloadXLS);
$('#reset').addEventListener('click', resetAll);

refresh();
