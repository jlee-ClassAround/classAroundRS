/**
 * Your Highness's Matching Engine v6.5 (Final Integrated Edition)
 * Features: Neon Button, Auto-Hide Status, Comprehensive ROI Summary
 */

const CONFIG = {
    CLIENT_ID: '222775165025-6hm6pfhblufcjrtatclj4gi5j6fsibnj.apps.googleusercontent.com',
    API_KEY: 'AIzaSyBPaE2YzmLpzzM1PvWk9OglwBA5qBFkYhg',
    DISCOVERY_DOCS: ['https://sheets.googleapis.com/$discovery/rest?version=v4'],
    SCOPES: 'https://www.googleapis.com/auth/spreadsheets.readonly',
    DEFAULT_SHEET_ID: '17m7yXKC8Pow9ovak5j_5_74sNckMH2bldRR0C-lG78M',
    COREDEV_LECTURE_API: 'https://d3vun18xqshzq8.cloudfront.net/lecture',
    COREDEV_HISTORY_API: 'https://d3vun18xqshzq8.cloudfront.net/tracking-history',
    COREDEV_AUTH:
        'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ7XCJpZFwiOlwiZTVlZDJhYTgtYjAwZC00ZDZkLTliMDktMmI1NTBmZjlmNGUxXCIsXCJyb2xlc1wiOlwiUk9MRV9VU0VSXCJ9IiwiaWF0IjoxNzY5MTI1MzU4LCJleHAiOjE3NjkyMTE3NTh9.d3UpOLwhbufheUE0QduPczRgLgngcYu4JSoEd79AZiQ'.replace(
            /\s/g,
            ''
        ),
};

const State = {
    trackingMap: new Map(),
    mediumTotalStats: new Map(),
    free: [],
    selectedLectures: [],
    loadedTabs: [],
};

const $ = (id) => document.getElementById(id);

// --- 💡 UI Utils (상태 메시지 자동 숨김 로직 포함) ---
const showToast = (m) => {
    const t = $('toast');
    t.innerText = m;
    t.style.display = 'block';
    setTimeout(() => (t.style.display = 'none'), 3000);
};

const updateStatus = (m) => {
    const s = $('app_status');
    if (!s) return;
    if (!m || m.trim() === '') {
        s.style.display = 'none'; // 메시지가 없으면 영역 자체를 숨김
    } else {
        s.style.display = 'inline-block';
        s.innerText = m;
    }
};

const normalizePhone = (v) => {
    let d = String(v || '').replace(/\D/g, '');
    if (d.startsWith('82')) d = '0' + d.slice(2);
    if (d.length === 10 && d.startsWith('10')) d = '0' + d;
    return d.length >= 10 && d.startsWith('01') ? d : null;
};

const parseAmount = (v) => parseInt(String(v || '0').replace(/[^0-9]/g, '')) || 0;

// --- ⚙️ Google API 초기화 및 네온 효과 제어 ---
window.onload = () => {
    gapi.load('client', async () => {
        await gapi.client.init({ apiKey: CONFIG.API_KEY, discoveryDocs: CONFIG.DISCOVERY_DOCS });
        const authBtn = $('auth_btn');
        if (authBtn) {
            authBtn.disabled = false; // 버튼 활성화 (이때 CSS의 네온 애니메이션이 작동함)
            updateStatus('Google 연동을 진행해 주십시오.');
        }
    });

    window.tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: CONFIG.CLIENT_ID,
        scope: CONFIG.SCOPES,
        callback: async (resp) => {
            if (resp.error) return;

            const authBtn = $('auth_btn');
            authBtn.innerText = '✅ Google 연동 완료';
            authBtn.classList.remove('btn-neon'); // 네온사인 애니메이션 제거
            authBtn.style.animation = 'none';
            authBtn.style.borderColor = '#34a853'; // 성공의 녹색 테두리

            updateStatus(''); // 💡 [핵심] 연동 완료 시 상태 문구 즉시 제거
            showToast('Google 시트 연동 성공');

            updateStatus('탭 목록 로드 중...');
            await fetchTabs(CONFIG.DEFAULT_SHEET_ID);
            updateStatus(''); // 로드 완료 후 다시 숨김
        },
    });
};

$('auth_btn').onclick = () => window.tokenClient.requestAccessToken();

// --- 🔍 강의 검색 및 모달 제어 ---
$('btn_open_search').onclick = () => {
    $('search_modal').style.display = 'block';
};
$('close_modal').onclick = () => {
    $('search_modal').style.display = 'none';
};

$('do_search').onclick = async () => {
    const kw = $('search_input').value.trim();
    if (!kw) return;
    try {
        updateStatus('강의 정보를 찾는 중...');
        const url = `${CONFIG.COREDEV_LECTURE_API}?page=0&size=20&name=${encodeURIComponent(kw)}&isPaid=false`;
        const resp = await fetch(url, { headers: { 'Nuf-Authorization': CONFIG.COREDEV_AUTH } });
        const data = await resp.json();
        $('search_results').innerHTML = data.content
            .map(
                (lec) => `
            <div class="search-item" onclick="this.querySelector('input').click()">
                <input type="checkbox" value="${lec.id}" data-name="${lec.name}" onclick="event.stopPropagation()">
                <span>${lec.name}</span>
            </div>
        `
            )
            .join('');
    } catch (e) {
        alert('검색 실패');
    } finally {
        updateStatus('');
    }
};

$('selection_complete').onclick = () => {
    const checked = document.querySelectorAll('#search_results input:checked');
    State.selectedLectures = Array.from(checked).map((c) => ({
        id: c.value,
        name: c.dataset.name,
    }));
    $('selected_count').innerText = `${State.selectedLectures.length}개의 강의가 선택되었습니다.`;
    $('search_modal').style.display = 'none';
};

// --- 📊 탭 선택 드롭다운 로직 ---
const trigger = $('tabs_select_trigger');
const dropdown = $('tabs_dropdown');
const searchInput = $('tabs_search_input');

trigger.onclick = () => {
    if (State.loadedTabs.length === 0) return;
    dropdown.style.display = dropdown.style.display === 'block' ? 'none' : 'block';
    searchInput.focus();
};

window.onclick = (e) => {
    if (!e.target.closest('.searchable-select')) dropdown.style.display = 'none';
};

searchInput.oninput = (e) => {
    const term = e.target.value.toLowerCase();
    renderDropdownItems(State.loadedTabs.filter((t) => t.toLowerCase().includes(term)));
};

function renderDropdownItems(tabs) {
    const list = $('tabs_list_items');
    list.innerHTML = tabs.map((t) => `<li onclick="selectTabItem('${t}')">${t}</li>`).join('');
}

window.selectTabItem = async function (tabName) {
    trigger.innerText = tabName;
    dropdown.style.display = 'none';
    updateStatus(`[${tabName}] 로드 중...`);
    try {
        const resp = await gapi.client.sheets.spreadsheets.values.get({
            spreadsheetId: CONFIG.DEFAULT_SHEET_ID,
            range: `'${tabName}'!A:Z`,
        });
        State.free = resp.result.values.slice(1);
        showToast(`탭 로드 완료: ${tabName}`);
        $('run_match').disabled = false;
    } catch (e) {
        alert('데이터 로드 실패');
    } finally {
        updateStatus('');
    }
};

async function fetchTabs(id) {
    try {
        const resp = await gapi.client.sheets.spreadsheets.get({ spreadsheetId: id });
        State.loadedTabs = resp.result.sheets.map((s) => s.properties.title);
        renderDropdownItems(State.loadedTabs);
        trigger.innerText = '분석할 탭을 선택해 주세요';
    } catch (e) {
        alert('탭 목록 로드 실패');
    }
}

// --- 🚀 성과 분석 실행 엔진 ---
$('run_match').onclick = async () => {
    try {
        updateStatus('분석 엔진 가동 중...');
        State.trackingMap.clear();
        State.mediumTotalStats.clear();
        for (const lecture of State.selectedLectures) {
            await fetchRecursiveHistory(lecture);
        }
        renderFinalReport();
    } catch (e) {
        alert('분석 중 오류 발생');
    } finally {
        updateStatus('');
    }
};

async function fetchRecursiveHistory(lecture, page = 0) {
    const url = `${CONFIG.COREDEV_HISTORY_API}?page=${page}&size=500&lecture=${lecture.id}`;
    const resp = await fetch(url, { headers: { 'Nuf-Authorization': CONFIG.COREDEV_AUTH } });
    const data = await resp.json();
    data.content.forEach((app) => {
        const mediumName = app.medium && app.medium.name ? app.medium.name : '미지정(직접유입)';
        const phone = normalizePhone(app.billingPhone);
        if (phone) State.trackingMap.set(phone, mediumName);
        State.mediumTotalStats.set(mediumName, (State.mediumTotalStats.get(mediumName) || 0) + 1);
    });
    if (data.last === false) await fetchRecursiveHistory(lecture, page + 1);
}

// --- 📊 최종 리포트 렌더링 (요약 섹션 강화) ---
function renderFinalReport() {
    let totalRevenue = 0;
    const stats = { paid: {}, organic: {}, other: { m: 0, s: 0 } };

    State.free.forEach((row) => {
        const phone = normalizePhone(row[4]);
        const amount = parseAmount(row[14]);
        if (amount <= 0) return;
        totalRevenue += amount;
        const medium = State.trackingMap.get(phone);
        if (medium) {
            const cat = medium.includes('구글') || medium.includes('메타') ? 'paid' : 'organic';
            if (!stats[cat][medium])
                stats[cat][medium] = { m: 0, s: 0, t: State.mediumTotalStats.get(medium) || 0 };
            stats[cat][medium].m++;
            stats[cat][medium].s += amount;
        } else {
            stats.other.m++;
            stats.other.s += amount;
        }
    });

    let pSum = { m: 0, t: 0, s: 0 };
    let oSum = { m: 0, t: 0, s: 0 };
    Object.values(stats.paid).forEach((v) => {
        pSum.m += v.m;
        pSum.t += v.t;
        pSum.s += v.s;
    });
    Object.values(stats.organic).forEach((v) => {
        oSum.m += v.m;
        oSum.t += v.t;
        oSum.s += v.s;
    });

    const formatRow = (name, m, t, s, total) => {
        const rate = t > 0 ? ((m / t) * 100).toFixed(1) : '0.0';
        const portion = total > 0 ? ((s / total) * 100).toFixed(1) : '0.0';
        return `<tr><td>${name}</td><td>${m}/${t}</td><td>${rate}%</td><td>${s.toLocaleString()}원</td><td>${portion}%</td></tr>`;
    };

    let html = '';
    const buildSection = (title, data) => {
        let rows = Object.entries(data)
            .map(([n, v]) => formatRow(n, v.m, v.t, v.s, totalRevenue))
            .join('');
        return `<div class="report-section"><h3>${title}</h3><table><thead><tr><th>유입 매체</th><th>매칭/트래킹</th><th>전환율</th><th>매출 합계</th><th>비중</th></tr></thead><tbody>${rows || '<tr><td colspan="5" style="text-align:center">데이터 없음</td></tr>'}</tbody></table></div>`;
    };

    html += buildSection('① 페이드 (광고 유입)', stats.paid);
    html += buildSection('② 오가닉 (추천 및 오가닉)', stats.organic);

    const otherPortion =
        totalRevenue > 0 ? ((stats.other.s / totalRevenue) * 100).toFixed(1) : '0.0';
    html += `<div class="report-section"><h3>③ 기타 (매칭 정보 없음)</h3><table><thead><tr><th>유입 매체</th><th>매칭</th><th>전환율</th><th>매출 합계</th><th>비중</th></tr></thead><tbody><tr><td>기타(직접/기존유입)</td><td>${stats.other.m}/-</td><td>-</td><td>${stats.other.s.toLocaleString()}원</td><td>${otherPortion}%</td></tr></tbody></table></div>`;

    // 💡 유어하이니스께서 요청하신 캡처 양식의 요약 카드
    html += `
        <div class="summary-card">
            <h3 style="margin-top:0">📈 성과 분석 종합 요약</h3>
            <p class="summary-line"><strong>페이드 요약</strong> : ${pSum.m}/${pSum.t} 전환율: ${pSum.t > 0 ? ((pSum.m / pSum.t) * 100).toFixed(1) : 0}% 결제금액 합계: ${pSum.s.toLocaleString()}원</p>
            <p class="summary-line"><strong>오가닉 요약</strong> : ${oSum.m}/${oSum.t} 전환율: ${oSum.t > 0 ? ((oSum.m / oSum.t) * 100).toFixed(1) : 0}% 결제금액 합계: ${oSum.s.toLocaleString()}원</p>
            <p style="font-size: 24px; color: var(--primary); font-weight: 800; margin: 15px 0 0; letter-spacing:-0.5px">전체 결제금액 합계 : ${totalRevenue.toLocaleString()}원</p>
        </div>
    `;

    $('report_container').innerHTML = html;
    showToast('성과 분석 완료');
}

$('reset_btn').onclick = () => {
    if (confirm('초기화하시겠습니까?')) location.reload();
};
