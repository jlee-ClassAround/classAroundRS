// ===== 유틸 =====
const COL = { NAME: 1, EMAIL: 2, PHONE: 3, SOURCE: 5 }; // B,C,D,F
const $ = (sel) => document.querySelector(sel);
const text = (sel, v) => {
    $(sel).textContent = v;
};
function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => t.classList.remove('show'), 2600);
}

// CSV 읽기 (UTF-8 우선, 깨짐 시 EUC-KR 재시도) + 견고한 파서
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
    if (/ /.test(txt)) {
        try {
            const alt = new TextDecoder('euc-kr').decode(u8);
            if (!/ /.test(alt)) txt = alt;
        } catch (_) {}
    }
    return txt.replace(/^\uFEFF/, ''); // BOM 제거
}
// 간단하지만 견고한 CSV 파서 (따옴표/줄바꿈/구분자 자동)
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
            if (c === '"') {
                q = true;
            } else if (c === delim) {
                row.push(field);
                field = '';
            } else if (c === '\n') {
                row.push(field);
                out.push(row);
                row = [];
                field = '';
            } else if (c === '\r') {
                /* ignore */
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
function normalizeDigits(s) {
    const d = String(s ?? '').replace(/\D+/g, '');
    if (!d) return '';
    let out = d.startsWith('82') ? '0' + d.slice(2) : d;
    if (out.length > 11) out = out.slice(-11);
    return out;
}

// ===== 상태 =====
let paidRows = [],
    freeRows = [],
    resultRows = [];
function refresh() {
    const ok = paidRows.length > 0 && freeRows.length > 0;
    $('#run').disabled = !ok;
}

async function onFile(e) {
    const id = e.target.id;
    const f = e.target.files?.[0];
    if (!f) {
        if (id === 'paid') paidRows = [];
        else freeRows = [];
        refresh();
        return;
    }
    text('#stat', `${f.name} 읽는 중…`);
    try {
        const txt = await readCsvText(f);
        const rows = parseCSV(txt);
        const body = rows.slice(1); // 1행 헤더
        if (id === 'paid') {
            paidRows = body;
            text('#paidCnt', paidRows.length);
        } else {
            freeRows = body;
            text('#freeCnt', freeRows.length);
        }
        text('#stat', '파일 로드 완료');
        toast(`${f.name} 불러오기 성공 (${body.length}행)`);
    } catch (err) {
        console.error(err);
        alert('CSV 읽기 오류: ' + (err.message || err));
        text('#stat', '오류');
    }
    refresh();
}
function convertToInt(value) {
    if (typeof value !== 'string') return 0;
    // ₩, $, , , 공백 등 모두 제거
    const num = value.replace(/[₩$,,\s]/g, '');
    // 숫자로 변환 (NaN 방지)
    return Number(num) || 0;
}
function runMatch() {
    const paidMap = new Map(); // phone -> amount(G)
    let totalPrice = 0;
    for (const r of paidRows) {
        const p = normalizeDigits(r[3]);
        if (p) {
            paidMap.set(p, r[6]);
        }
    }
    const out = [['이름(B)', '이메일(C)', '전화번호(D)', '유입경로(F)', '결제금액(G, 결제자)']];
    let matched = 0;

    for (const r of freeRows) {
        const p = normalizeDigits(r[3]);

        if (p && paidMap.has(p)) {
            out.push([r[1] ?? '', r[2] ?? '', r[3] ?? '', r[5] ?? '', paidMap.get(p) ?? '']);
            matched++;
            totalPrice += convertToInt(paidMap.get(p));
        }
    }
    resultRows = out;
    render(out);
    text('#matchCnt', matched);
    const has = out.length > 1;
    $('#dlCsv').disabled = !has;
    $('#dlXls').disabled = !has;
    text('#stat', `매칭 완료: ${matched}건`);
    text('#totalPrice', totalPrice.toLocaleString());
}

function render(rows) {
    const wrap = $('#tableWrap');
    if (rows.length === 0) {
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

function getBaseName() {
    let n = ($('#fname').value || '').trim();
    if (!n) n = 'matched';
    return n;
}

// === Excel 안전 CSV (UTF-8 + BOM, 전화번호 텍스트 강제) ===
function downloadCSV() {
    if (resultRows.length <= 1) return;
    const safe = resultRows.map((r, i) =>
        i === 0 ? r : [r[0], r[1], "'" + (r[2] ?? ''), r[3], r[4]]
    );
    const csv = toCSV(safe);
    const bom = '\uFEFF'; // BOM 추가 → 엑셀이 UTF-8로 인식
    downloadBlob(getBaseName() + '.csv', new Blob([bom, csv], { type: 'text/csv;charset=utf-8' }));
}

// === Excel(.xls) — HTML 기반 내보내기, 전화번호 텍스트 서식 ===
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
                `<td>${esc(r[1])}</td>` +
                `<td style="mso-number-format:'\\@'">${esc(r[2])}</td>` +
                `<td>${esc(r[3])}</td>` +
                `<td>${esc(r[4])}</td>` +
                '</tr>'
        )
        .join('');
    const html = `<!doctype html><html><head><meta charset="UTF-8"><title>matched</title></head><body><table border="1">${head}${body}</table></body></html>`;
    downloadBlob(getBaseName() + '.xls', new Blob([html], { type: 'application/vnd.ms-excel' }));
}

function resetAll() {
    paidRows = [];
    freeRows = [];
    resultRows = [];
    $('#paid').value = '';
    $('#free').value = '';
    text('#paidCnt', '0');
    text('#freeCnt', '0');
    text('#matchCnt', '0');
    $('#run').disabled = true;
    $('#dlCsv').disabled = true;
    $('#dlXls').disabled = true;
    $('#tableWrap').innerHTML = '';
    text('#stat', '대기 중');
    toast('초기화 완료');
}

// ===== 바인딩 =====
$('#paid').addEventListener('change', onFile);
$('#free').addEventListener('change', onFile);
$('#run').addEventListener('click', runMatch);
$('#dlCsv').addEventListener('click', downloadCSV);
$('#dlXls').addEventListener('click', downloadXLS);
$('#reset').addEventListener('click', resetAll);
