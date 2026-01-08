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
    let d = String(s ?? '').replace(/\D+/g, '');
    if (!d) return '';

    // +82 / 82 처리
    if (d.startsWith('82')) d = '0' + d.slice(2);

    // 엑셀 숫자형으로 010이 10으로 날아간 케이스 보정 (010xxxxxxxx -> 10xxxxxxxx)
    if (d.length === 10 && d.startsWith('10')) d = '0' + d;

    // 너무 길면 뒤 11자리만
    if (d.length > 11) d = d.slice(-11);

    // 휴대폰 번호 형태만 통과(01로 시작, 10~11자리)
    if (!/^01\d{8,9}$/.test(d)) return '';

    return d;
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
        if (id === 'paid') paidRows = [];
        else if (id === 'free') freeRows = [];
        else usersRows = [];
        refresh();
        return;
    }

    text('#stat', `${f.name} 읽는 중…`);

    try {
        let rows = [];

        // -----------------------------
        // ① XLSX 파일인지 판별
        // -----------------------------
        if (f.name.endsWith('.xlsx') || f.name.endsWith('.xls')) {
            const ab = await readAsArrayBuffer(f);
            const wb = XLSX.read(ab, { type: 'array' });
            const ws = wb.Sheets[wb.SheetNames[0]];
            const json = XLSX.utils.sheet_to_json(ws, { header: 1 });
            rows = json;
        }
        // -----------------------------
        // ② CSV 파일 처리
        // -----------------------------
        else {
            const txt = await readCsvText(f);
            rows = parseCSV(txt);
        }

        const body = rows.slice(1); // 헤더 제외

        if (id === 'paid') paidRows = body;
        else if (id === 'free') freeRows = body;
        else usersRows = body;

        text('#stat', `파일 로드 완료`);
        toast(`${f.name} 불러오기 성공 (${body.length}행)`);
    } catch (err) {
        console.error(err);
        alert('파일 읽기 오류: ' + (err.message || err));
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
    const out = [['이름(B)', '이메일(C)', '전화번호(D)', '유입경로(F)', '결제금액(G)', '가입일']];

    const paidMap = new Map(); // phone -> 유입경로
    const typeMap = new Map(); // type -> [matchedCount, sum, totalCount]
    const usersMap = new Map(); // phone -> 가입일
    let matched = 0;

    // ✅ usersRows → phone 기준 (이미 폰 기준이라 그대로)
    if (usersRows.length > 0) {
        for (const r of usersRows) {
            const phone = normalizeDigits(r[1]);
            const createdAt = r[2] || '';
            if (phone) usersMap.set(phone, createdAt);
        }
    }

    // ✅ paidRows → phone 기준으로만 유입경로 맵 생성
    for (const r of paidRows) {
        const phone = normalizeDigits(r[6]); // ⚠️ 너 파일 구조에 맞는 인덱스 유지
        const source = String(r[3] || '기타').trim(); // ⚠️ 인덱스 유지

        if (!phone) continue;

        paidMap.set(phone, source);

        // 유입경로별 전체 카운트(결제자 파일 기준)
        if (typeMap.has(source)) {
            const [matchedCount, sum, totalCount] = typeMap.get(source);
            typeMap.set(source, [matchedCount, sum, totalCount + 1]);
        } else {
            typeMap.set(source, [0, 0, 1]);
        }
    }

    // ✅ freeRows 순회: "검증/매칭"은 오직 전화번호로만
    for (const r of freeRows) {
        const rawPhone = r[4] ?? ''; // ⚠️ 인덱스 유지
        const p = normalizeDigits(rawPhone);
        const amount = convertToInt(String(r[14] ?? '')); // ⚠️ XLSX 숫자셀 방지

        if (amount <= 0) continue;

        const isMatched = !!(p && paidMap.has(p)); // ✅ 폰번호로만 검증

        const type = isMatched ? paidMap.get(p) : '기타';
        const joinedDate = p ? usersMap.get(p) || '' : '';

        if (isMatched) matched++;

        // typeMap 업데이트(매칭카운트/금액)
        if (typeMap.has(type)) {
            const [matchedCount, sum, totalCount] = typeMap.get(type);
            typeMap.set(type, [matchedCount + 1, sum + amount, totalCount]);
        } else {
            typeMap.set(type, [1, amount, 0]);
        }

        out.push([
            r[3] ?? '', // 이름(출력용)
            r[5] ?? '', // 이메일(출력용)
            rawPhone ?? '', // 전화번호(원본 출력)
            type, // 유입경로
            r[14] ?? '', // 결제금액(원본)
            joinedDate, // 가입일
        ]);
    }

    resultRows = out;
    render(out);

    // ✅ 통계 렌더링(기존 그대로)
    const statDiv = document.querySelector('.stat');
    const counts = Array.from(typeMap.entries());

    let totalAmountPrice = 0;
    counts.forEach(([_, [, sum]]) => {
        totalAmountPrice += sum;
    });

    const paidKeys = ['메타', '구글'];

    function isOtherKey(key) {
        if (!key) return true;
        const k = String(key).trim();
        if (k === '' || k === '-' || k.includes('기타')) return true;
        return false;
    }

    const paidList = [];
    const organicList = [];
    const otherList = [];

    counts.forEach(([key, [matchedCount, sum, totalCount]]) => {
        if (paidKeys.includes(key)) {
            paidList.push([key, matchedCount, sum, totalCount]);
            return;
        }
        if (isOtherKey(key)) {
            otherList.push([key || '기타', matchedCount, sum, totalCount]);
            return;
        }
        organicList.push([key, matchedCount, sum, totalCount]);
    });

    function makeTable(title, rows) {
        let html = `
        <h3 style="margin:10px 0;">${title}</h3>
        <table style="width:100%; border-collapse:collapse; margin-bottom:15px; font-size:15px;">
        <thead>
            <tr style="background:#f6f6f6;">
                <th style="padding:8px;">유입경로</th>
                <th style="padding:8px; text-align:right;">매칭</th>
                <th style="padding:8px; text-align:right;">전환률</th>
                <th style="padding:8px; text-align:right;">결제금액 합계</th>
                <th style="padding:8px; text-align:right;">비중</th>
            </tr>
        </thead>
        <tbody>
    `;

        rows.forEach(([key, matchedCount, sum, totalCount]) => {
            const ratio = totalCount > 0 ? ((matchedCount / totalCount) * 100).toFixed(1) : '0.0';
            const portion =
                totalAmountPrice > 0 ? ((sum / totalAmountPrice) * 100).toFixed(1) : '0.0';

            html += `
            <tr style="border-bottom:1px solid #eee;">
                <td style="padding:8px;">${key}</td>
                <td style="padding:8px; text-align:right;">${matchedCount}/${totalCount}</td>
                <td style="padding:8px; text-align:right;">${ratio}%</td>
                <td style="padding:8px; text-align:right;">${sum.toLocaleString()}원</td>
                <td style="padding:8px; text-align:right;">${portion}%</td>
            </tr>
        `;
        });

        html += `</tbody></table>`;
        return html;
    }

    function calcSummary(list) {
        let matched = 0;
        let total = 0;
        let amount = 0;

        list.forEach(([_, mCount, sum, tCount]) => {
            matched += mCount;
            total += tCount;
            amount += sum;
        });

        const ratio = total > 0 ? ((matched / total) * 100).toFixed(1) : '0.0';
        return { matched, total, amount, ratio };
    }

    const paidSummary = calcSummary(paidList);
    const organicSummary = calcSummary(organicList);

    let html = '';
    html += makeTable('① 페이드', paidList);
    html += makeTable('② 오가닉', organicList);
    html += makeTable('③ 기타 (기존 회원)', otherList);

    html += `
<h3 style="margin-top:20px;">전체 요약</h3>
<p><b>페이드 요약</b> : ${paidSummary.matched}/${paidSummary.total}  
   전환률: ${paidSummary.ratio}%  
   결제금액 합계: ${paidSummary.amount.toLocaleString()}원</p>

<p><b>오가닉 요약</b> : ${organicSummary.matched}/${organicSummary.total}  
   전환률: ${organicSummary.ratio}%  
   결제금액 합계: ${organicSummary.amount.toLocaleString()}원</p>

<p><b>전체 결제금액 합계</b> : ${totalAmountPrice.toLocaleString()}원</p>
`;

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
        i === 0 ? r : [r[0], r[1], "'" + (r[2] ?? ''), r[3], r[4], r[5]]
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
                `<td>${esc(r[5])}</td>` +
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
