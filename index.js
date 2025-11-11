// ===== 유틸 =====
const COL = { NAME: 1, EMAIL: 2, PHONE: 3, SOURCE: 5 }; // B,C,D,F
const $ = (sel) => document.querySelector(sel);
const text = (sel, v) => {
    $(sel).textContent = v;
};
const price = (sel, v) => {
    $(sel).textContent = '₩' + v.toLocaleString();
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
    usersRows = [],
    resultRows = [];

// 안전하게 value 읽기
function getDateVal(el) {
    return el && typeof el.value === 'string' ? el.value.trim() : '';
}

// 기존 함수 교체
function refresh() {
    // const matchTypeInput = document.getElementById('matchType');
    // const value = matchTypeInput.value.trim();
    const hasFiles = paidRows.length > 0 && freeRows.length > 0;

    $('#run').disabled = !hasFiles;
}
async function onFile(e) {
    const id = e.target.id;
    const f = e.target.files?.[0];
    if (!f) {
        if (id === 'paid') {
            paidRows = [];
        } else if (id === 'free') {
            freeRows = [];
        } else {
            usersRows = [];
        }
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
        } else if (id === 'free') {
            freeRows = body;
        } else {
            usersRows = body;
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
    const out = [['이름(B)', '이메일(C)', '전화번호(D)', '유입경로(F)', '결제금액(G, 결제자)']];
    let matched = 0;

    const usersMap = new Map();
    const paidMap = new Map();
    const typeMap = new Map(); // key -> [matchedCount, sum, totalCount]

    // ✅ 회원가입 목록 매핑
    if (usersRows.length > 0) {
        for (const r of usersRows) {
            const p = normalizeDigits(r[1]);
            if (p) usersMap.set(p, r[1]);
        }

        for (const r of paidRows) {
            const p = normalizeDigits(r[6]);
            if (p && usersMap.has(p)) {
                paidMap.set(p, r[3] || '기타');
            }
        }
    } else {
        for (const r of paidRows) {
            const p = normalizeDigits(r[6]);
            paidMap.set(p, r[3] || '기타');
        }
    }

    // ✅ ① 전체 유입경로 수 (paidRows 기준)
    for (const r of paidRows) {
        const type = (r[3] && r[3].trim()) || '기타';
        if (typeMap.has(type)) {
            const [matchedCount, sum, totalCount] = typeMap.get(type);
            typeMap.set(type, [matchedCount, sum, totalCount + 1]);
        } else {
            typeMap.set(type, [0, 0, 1]);
        }
    }

    // ✅ ② freeRows 매칭 시작
    for (const r of freeRows) {
        const p = normalizeDigits(r[4]);
        const amount = convertToInt(r[14]);
        const type = p && paidMap.has(p) ? paidMap.get(p)?.trim() || '기타' : '기타';

        if (p && paidMap.has(p)) matched++;

        if (typeMap.has(type)) {
            const [matchedCount, sum, totalCount] = typeMap.get(type);
            typeMap.set(type, [matchedCount + 1, sum + amount, totalCount]);
        } else {
            // ⚠️ freeRows에서만 등장한 신규 type은 totalCount = 0으로 둔다
            typeMap.set(type, [1, amount, 0]);
        }

        out.push([r[3] ?? '', r[5] ?? '', r[4] ?? '', type, r[14]]);
    }

    resultRows = out;
    render(out);

    // ✅ ③ 통계 렌더링
    const statDiv = document.querySelector('.stat');
    const counts = Array.from(typeMap.entries());

    let html = `<br>`;
    counts.forEach(([key, [matchedCount, sum, totalCount]]) => {
        const ratio = totalCount > 0 ? ((matchedCount / totalCount) * 100).toFixed(1) : '0.0';
        html += `
        <p style="margin:6px 0; line-height:1.6;">
          <b>${key}</b> : ${matchedCount}/${totalCount}건
          <span style="margin-left:10px;">전환률: ${ratio}%</span>
          <span style="margin-left:10px;">결제금액 합계: ${sum.toLocaleString()}원</span>
        </p>`;
    });

    statDiv.innerHTML = html;

    const has = out.length > 1;
    $('#dlCsv').disabled = !has;
    $('#dlXls').disabled = !has;
    text('#stat', `매칭 완료: ${matched}건`);
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
$('#users').addEventListener('change', onFile);
// $('#matchType').addEventListener('change', refresh);
$('#run').addEventListener('click', runMatch);
$('#dlCsv').addEventListener('click', downloadCSV);
$('#dlXls').addEventListener('click', downloadXLS);
$('#reset').addEventListener('click', resetAll);
