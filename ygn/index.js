// =====================
// 유틸
// =====================
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

function isNonEmptyRow(r) {
    return Array.isArray(r) && r.some((c) => String(c ?? '').trim() !== '');
}

function moneyToNumber(v) {
    if (v == null) return 0;
    if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
    const s = String(v).trim();
    if (!s) return 0;
    const num = s.replace(/[^\d.-]/g, '');
    const n = Number(num);
    return Number.isFinite(n) ? n : 0;
}

// ✅ 전화번호 정규화: 하이픈/공백 제거 + +82 변환 + "0 빠진 값" 보정
function normalizeDigits(s) {
    let d = String(s ?? '').replace(/\D+/g, '');
    if (!d) return '';

    // +82 -> 0
    if (d.startsWith('82')) d = '0' + d.slice(2);

    // ✅ 0이 빠진 케이스 보정: 10자리 & 1로 시작하면 앞에 0 붙임
    // 예: 1096888984 -> 01096888984
    if (d.length === 10 && d.startsWith('1')) d = '0' + d;

    // 너무 길면(한 셀에 여러 숫자 섞임) 일단 뒤 11자리만
    if (d.length > 11) d = d.slice(-11);

    return d;
}

function findColIndex(headerRow, candidates) {
    const norm = (x) =>
        String(x ?? '')
            .trim()
            .replace(/\s+/g, '')
            .toLowerCase();

    const header = (headerRow ?? []).map(norm);
    for (const c of candidates) {
        const target = norm(c);
        const idx = header.findIndex((h) => h === target || h.includes(target));
        if (idx >= 0) return idx;
    }
    return -1;
}

// =====================
// 엑셀에서 "진짜 표" 찾기 (핵심)
// =====================
const PHONE_CANDS = ['전화번호', '연락처', '휴대폰', '휴대전화', '핸드폰'];
const AMOUNT_CANDS = ['최종금액', '최종결제금액', '최종 금액', '결제금액', '결제 금액'];
const STATUS_CANDS = ['결제상태', '상태'];

function detectTableInRows(rows, mustHavePhone, mustHaveAmount) {
    const scanMax = Math.min(rows.length, 150);

    let best = null;

    for (let i = 0; i < scanMax; i++) {
        const header = rows[i];
        if (!Array.isArray(header)) continue;

        const phoneIdx = mustHavePhone ? findColIndex(header, PHONE_CANDS) : -1;
        const amountIdx = mustHaveAmount ? findColIndex(header, AMOUNT_CANDS) : -1;

        const okPhone = !mustHavePhone || phoneIdx >= 0;
        const okAmount = !mustHaveAmount || amountIdx >= 0;
        if (!okPhone || !okAmount) continue;

        // 후보 헤더 발견 -> 아래 행들에서 "전화번호가 실제로 채워진 행"이 얼마나 있는지로 점수 계산
        const body = rows.slice(i + 1).filter(isNonEmptyRow);
        const sampleMax = Math.min(body.length, 800);

        let phoneFilled = 0;
        let amountPositive = 0;

        for (let k = 0; k < sampleMax; k++) {
            const r = body[k];

            // 중간에 헤더가 반복되는 경우 제외
            const maybeHeaderAgain =
                String(r[phoneIdx] ?? '').includes('전화') ||
                String(r[amountIdx] ?? '').includes('금액');
            if (maybeHeaderAgain) continue;

            const p = normalizeDigits(r[phoneIdx]);
            if (p) phoneFilled++;

            if (mustHaveAmount) {
                const a = moneyToNumber(r[amountIdx]);
                if (a > 0) amountPositive++;
            }
        }

        const score = phoneFilled * 100000 + amountPositive * 100 + body.length;

        if (!best || score > best.score) {
            best = {
                headerRowIndex: i,
                header,
                body,
                phoneIdx,
                amountIdx,
                score,
                phoneFilled,
                amountPositive,
            };
        }
    }

    return best;
}

function pickBestTableFromWorkbook(wb, mustHavePhone, mustHaveAmount) {
    let best = null;

    for (const sheetName of wb.SheetNames) {
        const ws = wb.Sheets[sheetName];
        const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' }).filter(isNonEmptyRow);
        if (rows.length === 0) continue;

        const cand = detectTableInRows(rows, mustHavePhone, mustHaveAmount);
        if (!cand) continue;

        const withSheet = { sheetName, ...cand };
        if (!best || withSheet.score > best.score) best = withSheet;
    }

    return best;
}

// =====================
// 상태
// =====================
let paidHeader = [];
let paidBody = [];
let freeHeader = [];
let freeBody = [];
let resultRows = [];

let paidMeta = null;
let freeMeta = null;

// =====================
// UI
// =====================
function refresh() {
    const hasFiles = paidBody.length > 0 && freeBody.length > 0;
    $('#run').disabled = !hasFiles;
}

async function onFile(e) {
    const id = e.target.id; // paid / free
    const f = e.target.files?.[0];

    if (!f) {
        if (id === 'paid') {
            paidHeader = [];
            paidBody = [];
            paidMeta = null;
        } else {
            freeHeader = [];
            freeBody = [];
            freeMeta = null;
        }
        refresh();
        return;
    }

    text('#stat', `${f.name} 읽는 중…`);

    try {
        if (f.name.endsWith('.xlsx') || f.name.endsWith('.xls')) {
            const ab = await readAsArrayBuffer(f);
            const wb = XLSX.read(ab, { type: 'array' });

            // paid는 phone+amount 둘 다 있는 표를 찾는다 (진짜 결제표만 잡기)
            const mustHavePhone = true;
            const mustHaveAmount = id === 'paid';

            const best = pickBestTableFromWorkbook(wb, mustHavePhone, mustHaveAmount);

            if (!best) throw new Error('엑셀에서 유효한 표(전화번호/금액)를 찾지 못했어요.');

            const {
                sheetName,
                headerRowIndex,
                header,
                body,
                phoneIdx,
                amountIdx,
                phoneFilled,
                amountPositive,
            } = best;

            if (id === 'paid') {
                paidHeader = header;
                paidBody = body;
                paidMeta = {
                    file: f.name,
                    sheetName,
                    headerRowIndex,
                    phoneIdx,
                    amountIdx,
                    phoneFilled,
                    amountPositive,
                };
            } else {
                freeHeader = header;
                freeBody = body;
                freeMeta = { file: f.name, sheetName, headerRowIndex, phoneIdx };
            }

            console.log('[XLSX PICK]', {
                id,
                file: f.name,
                sheetName,
                headerRowIndex,
                phoneIdx,
                amountIdx,
                phoneFilled,
                amountPositive,
                header,
            });

            text('#stat', `파일 로드 완료`);
            toast(`${f.name} 불러오기 성공 (${body.length}행)`);
            refresh();
            return;
        }

        // CSV
        const txt = await readCsvText(f);
        const rows = parseCSV(txt).filter(isNonEmptyRow);
        const header = rows[0] ?? [];
        const body = rows.slice(1);

        if (id === 'paid') {
            paidHeader = header;
            paidBody = body;
            paidMeta = { file: f.name, sheetName: 'CSV', headerRowIndex: 0 };
        } else {
            freeHeader = header;
            freeBody = body;
            freeMeta = { file: f.name, sheetName: 'CSV', headerRowIndex: 0 };
        }

        text('#stat', `파일 로드 완료`);
        toast(`${f.name} 불러오기 성공 (${body.length}행)`);
    } catch (err) {
        console.error(err);
        alert('파일 읽기 오류: ' + (err.message || err));
        text('#stat', '오류');
    }

    refresh();
}

// =====================
// 매칭
// =====================
function runMatch() {
    // =========================
    // 내용 기반 열 추정(결제자 파일용)
    // =========================
    const PHONE_CANDS = ['전화번호', '연락처', '휴대폰', '휴대전화', '핸드폰'];
    const AMOUNT_CANDS = ['최종금액', '최종결제금액', '최종 금액', '결제금액', '결제 금액'];
    const STATUS_CANDS = ['결제상태', '상태'];
    const NAME_CANDS_FREE = ['이름', '성함', '신청자', '구매자'];

    const looksLikePhone = (v) => {
        const p = normalizeDigits(v);
        return p && (p.length === 10 || p.length === 11);
    };

    const guessPhoneColByContent = (rows, scanRows = 400) => {
        const sample = rows.slice(0, scanRows);
        const maxCols = Math.max(...sample.map((r) => (Array.isArray(r) ? r.length : 0)), 0);
        let bestIdx = -1;
        let bestScore = 0;

        for (let c = 0; c < maxCols; c++) {
            let hit = 0;
            for (const r of sample) if (Array.isArray(r) && looksLikePhone(r[c])) hit++;
            if (hit > bestScore) {
                bestScore = hit;
                bestIdx = c;
            }
        }
        return { idx: bestIdx, score: bestScore };
    };

    const guessAmountColByContent = (rows, scanRows = 400) => {
        const sample = rows.slice(0, scanRows);
        const maxCols = Math.max(...sample.map((r) => (Array.isArray(r) ? r.length : 0)), 0);
        let bestIdx = -1;
        let bestScore = 0;

        for (let c = 0; c < maxCols; c++) {
            let pos = 0;
            for (const r of sample) if (Array.isArray(r) && moneyToNumber(r[c]) > 0) pos++;
            if (pos > bestScore) {
                bestScore = pos;
                bestIdx = c;
            }
        }
        return { idx: bestIdx, score: bestScore };
    };

    const paidPhoneNonEmpty = (idx) =>
        paidBody.slice(0, 200).reduce((acc, r) => {
            if (!Array.isArray(r)) return acc;
            return normalizeDigits(r[idx]) ? acc + 1 : acc;
        }, 0);

    const paidAmountPositive = (idx) =>
        paidBody.slice(0, 200).reduce((acc, r) => {
            if (!Array.isArray(r)) return acc;
            return moneyToNumber(r[idx]) > 0 ? acc + 1 : acc;
        }, 0);

    // =========================
    // 1) 신청자(첫 파일)에서 이름/전화번호 열 찾기
    // =========================
    const freeNameIdx = findColIndex(freeHeader, NAME_CANDS_FREE);
    const freePhoneIdx = findColIndex(freeHeader, [
        '연락처',
        '전화번호',
        '휴대폰',
        '휴대전화',
        '핸드폰',
    ]);

    if (freeNameIdx < 0) return alert('첫번째 파일(신청자)에서 “이름” 컬럼을 찾지 못했어요.');
    if (freePhoneIdx < 0)
        return alert('첫번째 파일(신청자)에서 “연락처/전화번호” 컬럼을 찾지 못했어요.');

    // =========================
    // 2) 결제자(두번째 파일)에서 전화번호/최종금액 열 찾기
    // =========================
    let paidPhoneIdx = findColIndex(paidHeader, PHONE_CANDS);
    let paidAmountIdx = findColIndex(paidHeader, AMOUNT_CANDS);
    const paidStatusIdx = findColIndex(paidHeader, STATUS_CANDS);

    // 헤더로 잡힌 열이 실제로 값이 있는지 검증 -> 없으면 내용 기반 재추정
    const phoneOk = paidPhoneIdx >= 0 ? paidPhoneNonEmpty(paidPhoneIdx) >= 5 : false;
    const amountOk = paidAmountIdx >= 0 ? paidAmountPositive(paidAmountIdx) >= 5 : false;

    if (!phoneOk) {
        const g = guessPhoneColByContent(paidBody, 600);
        if (g.idx >= 0 && g.score > 0) paidPhoneIdx = g.idx;
    }
    if (!amountOk) {
        const g = guessAmountColByContent(paidBody, 600);
        if (g.idx >= 0 && g.score > 0) paidAmountIdx = g.idx;
    }

    // 최후 fallback: 캡처 기준 E=4, O=14
    if (paidPhoneIdx < 0) paidPhoneIdx = 4;
    if (paidAmountIdx < 0) paidAmountIdx = 14;

    if (paidPhoneIdx < 0) return alert('두번째 파일(결제자)에서 “전화번호” 열을 찾지 못했어요.');
    if (paidAmountIdx < 0) return alert('두번째 파일(결제자)에서 “최종금액” 열을 찾지 못했어요.');

    // =========================
    // 3) 결제자 Map 만들기: phone -> sum(최종금액 합계)
    // =========================
    const paidSumMap = new Map(); // phone -> sum
    for (const r of paidBody) {
        if (!Array.isArray(r)) continue;

        const phone = normalizeDigits(r[paidPhoneIdx]);
        if (!phone) continue;

        const amt = moneyToNumber(r[paidAmountIdx]);
        if (amt <= 0) continue;

        // 결제상태가 있으면 환불/취소 제외
        if (paidStatusIdx >= 0) {
            const st = String(r[paidStatusIdx] ?? '').trim();
            if (st.includes('환불') || st.includes('취소')) continue;
        }

        paidSumMap.set(phone, (paidSumMap.get(phone) || 0) + amt);
    }

    // =========================
    // 4) 결과 테이블: 이름 / 핸드폰번호 / 결제금액(합계)
    //    - 신청자 파일 기준으로 행 생성
    //    - 매칭 안 되면 결제금액 0
    // =========================
    const out = [['이름', '핸드폰번호', '결제금액']];

    let matchedCount = 0;
    let totalAmount = 0;

    for (const r of freeBody) {
        const name = String(r[freeNameIdx] ?? '').trim();
        const rawPhone = String(r[freePhoneIdx] ?? '').trim();
        const phone = normalizeDigits(rawPhone);

        const sum = phone && paidSumMap.has(phone) ? paidSumMap.get(phone) : 0;

        if (sum > 0) {
            matchedCount++;
            totalAmount += sum;
        }

        out.push([name, rawPhone, sum]);
    }

    resultRows = out;
    render(out);

    // =========================
    // 5) 요약(건수/합계)
    // =========================
    const statDiv = document.querySelector('.stat');
    statDiv.innerHTML = `
      <div style="padding:10px; background:#eef6ff; border:1px solid #cfe5ff; border-radius:10px; margin-bottom:12px;">
        <b>사용중인 결제자 열</b><br/>
        전화번호 idx: <b>${paidPhoneIdx}</b> (캡처 기준 E=4) / 최종금액 idx: <b>${paidAmountIdx}</b> (캡처 기준 O=14)<br/>
        전화번호 유효(샘플200): <b>${paidPhoneNonEmpty(
            paidPhoneIdx
        )}</b> / 금액>0(샘플200): <b>${paidAmountPositive(paidAmountIdx)}</b>
      </div>

      <h3 style="margin:10px 0;">요약</h3>
      <p style="margin:6px 0;">매칭 건수(결제금액 > 0): <b>${matchedCount.toLocaleString()}</b>건</p>
      <p style="margin:6px 0;">총 결제금액 합계: <b>₩${totalAmount.toLocaleString()}</b></p>
    `;

    const has = out.length > 1;
    $('#dlCsv').disabled = !has;
    $('#dlXls').disabled = !has;

    text('#stat', `완료: ${matchedCount}건 / ₩${totalAmount.toLocaleString()}`);
    toast(`완료: ${matchedCount}건 매칭`);
}

// =====================
// 렌더/다운로드/리셋
// =====================
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

function downloadCSV() {
    if (resultRows.length <= 1) return;

    const safe = resultRows.map((r, i) => {
        if (i === 0) return r;
        return [r[0], r[1], "'" + (r[2] ?? ''), r[3], r[4], r[5]];
    });

    const csv = toCSV(safe);
    const bom = '\uFEFF';
    downloadBlob(getBaseName() + '.csv', new Blob([bom, csv], { type: 'text/csv;charset=utf-8' }));
}

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

    const html = `<!doctype html><html><head><meta charset="UTF-8"><title>${esc(
        getBaseName()
    )}</title></head><body><table border="1">${head}${body}</table></body></html>`;

    downloadBlob(getBaseName() + '.xls', new Blob([html], { type: 'application/vnd.ms-excel' }));
}

function resetAll() {
    paidHeader = [];
    paidBody = [];
    freeHeader = [];
    freeBody = [];
    resultRows = [];
    paidMeta = null;
    freeMeta = null;

    $('#paid').value = '';
    $('#free').value = '';
    $('#run').disabled = true;
    $('#dlCsv').disabled = true;
    $('#dlXls').disabled = true;
    $('#tableWrap').innerHTML = '';
    const statDiv = document.querySelector('.stat');
    if (statDiv) statDiv.innerHTML = '';

    text('#stat', '대기 중');
    toast('초기화 완료');
    refresh();
}

// =====================
// 바인딩
// =====================
$('#paid').addEventListener('change', onFile);
$('#free').addEventListener('change', onFile);
$('#run').addEventListener('click', runMatch);
$('#dlCsv').addEventListener('click', downloadCSV);
$('#dlXls').addEventListener('click', downloadXLS);
$('#reset').addEventListener('click', resetAll);

refresh();
