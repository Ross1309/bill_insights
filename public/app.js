const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// State caches to minimize Firestore reads
let allBills = [];
let allVotes = [];
let allMembers = [];
let currentCategory = 'all';
let searchQuery = '';
let activeTab = 'bills';

async function initApp() {
  setupTabNavigation();
  setupEventListeners();
  await loadBillsData();
}

// --- TAB SWITCHING LOGIC ---
function setupTabNavigation() {
  const tabs = {
    'nav-bills': 'view-bills',
    'nav-votes': 'view-votes',
    'nav-members': 'view-members'
  };

  Object.keys(tabs).forEach(navId => {
    document.getElementById(navId).addEventListener('click', async (e) => {
      // Update tab button styles
      Object.keys(tabs).forEach(id => {
        const btn = document.getElementById(id);
        btn.className = "nav-tab pb-3 font-semibold text-gray-500 hover:text-gray-700 focus:outline-none transition";
      });
      e.target.className = "nav-tab pb-3 font-semibold text-blue-600 border-b-2 border-blue-600 focus:outline-none transition";

      // Hide all views, show active view
      Object.values(tabs).forEach(viewId => {
        document.getElementById(viewId).classList.add('hidden');
      });
      const activeView = tabs[navId];
      document.getElementById(activeView).classList.remove('hidden');

      // Lazy load data if switching tabs
      if (navId === 'nav-votes' && allVotes.length === 0) {
        await loadVotesData();
      } else if (navId === 'nav-members' && allMembers.length === 0) {
        await loadMembersData(document.getElementById('state-select').value);
      }
    });
  });
}

// --- DATA FETCHERS ---
async function loadBillsData() {
  const container = document.getElementById('bills-container');
  try {
    const q = query(collection(db, "bills"), limit(20));
    const snapshot = await getDocs(q);
    allBills = [];
    snapshot.forEach(doc => allBills.push({ id: doc.id, ...doc.data() }));
    renderBills();
  } catch (err) {
    console.error("Error loading bills:", err);
    container.innerHTML = `<p class="text-center text-red-500 py-8">Failed to load bills: ${err.message}</p>`;
  }
}

async function loadVotesData() {
  const container = document.getElementById('votes-container');
  try {
    const q = query(collection(db, "votes"), limit(15));
    const snapshot = await getDocs(q);
    allVotes = [];
    snapshot.forEach(doc => allVotes.push({ id: doc.id, ...doc.data() }));
    renderVotes();
  } catch (err) {
    console.error("Error loading votes:", err);
    container.innerHTML = `<p class="text-center text-red-500 py-8">Failed to load votes: ${err.message}</p>`;
  }
}

async function loadMembersData(stateCode) {
  const container = document.getElementById('members-container');
  container.innerHTML = `<div class="text-center py-12"><div class="inline-block animate-spin rounded-full h-8 w-8 border-4 border-blue-500 border-t-transparent mb-4"></div><p class="text-gray-500">Loading legislators for ${stateCode}...</p></div>`;

  try {
    const q = query(collection(db, "members"), where("state", "==", stateCode));
    const snapshot = await getDocs(q);
    allMembers = [];
    snapshot.forEach(doc => allMembers.push({ id: doc.id, ...doc.data() }));
    renderMembers();
  } catch (err) {
    console.error("Error loading members:", err);
    container.innerHTML = `<p class="text-center text-red-500 py-8">Failed to load members: ${err.message}</p>`;
  }
}

// --- RENDER FUNCTIONS ---
function renderBills() {
  const container = document.getElementById('bills-container');
  const filtered = allBills.filter(bill => {
    const matchesCategory = currentCategory === 'all' || bill.category === currentCategory;
    const matchesSearch = !searchQuery || 
      (bill.title && bill.title.toLowerCase().includes(searchQuery.toLowerCase())) ||
      (bill.bill_number && bill.bill_number.toLowerCase().includes(searchQuery.toLowerCase()));
    return matchesCategory && matchesSearch;
  });

  if (filtered.length === 0) {
    container.innerHTML = `<p class="text-center text-gray-500 py-12">No matching bills found.</p>`;
    return;
  }

  let html = '<div class="grid gap-6 md:grid-cols-2 lg:grid-cols-3">';
  filtered.forEach((bill) => {
    const bullets = bill.ai_summary?.bullet_points || [];
    html += `
      <div class="border rounded-xl p-5 shadow-sm bg-white flex flex-col justify-between hover:shadow-md transition">
        <div>
          <div class="flex justify-between items-center mb-2">
            <span class="text-xs font-semibold px-2.5 py-0.5 rounded bg-blue-100 text-blue-800">${bill.category || 'General'}</span>
            <span class="text-xs font-semibold text-gray-500">${bill.bill_number || ''}</span>
          </div>
          <h3 class="font-bold text-lg mb-3 text-gray-900 leading-snug">${bill.title || 'Untitled Bill'}</h3>
          <ul class="list-disc list-inside text-sm text-gray-600 space-y-1 mb-4">
            ${bullets.map(b => `<li>${b}</li>`).join('')}
          </ul>
        </div>
        <div class="text-xs text-gray-400 border-t pt-3 flex justify-between">
          <span>Chamber: ${bill.chamber || 'N/A'}</span>
          <span>Date: ${bill.date_voted || 'N/A'}</span>
        </div>
      </div>
    `;
  });
  html += '</div>';
  container.innerHTML = html;
}

function renderVotes() {
  const container = document.getElementById('votes-container');
  if (allVotes.length === 0) {
    container.innerHTML = `<p class="text-center text-gray-500 py-12">No roll-call vote records found in database. Run your ingestion function to populate.</p>`;
    return;
  }

  let html = '<div class="space-y-6">';
  allVotes.forEach(vote => {
    const tallies = vote.tallies || { yea: 0, nay: 0, not_voting: 0 };
    html += `
      <div class="border rounded-xl p-6 shadow-sm bg-white">
        <div class="flex flex-col sm:flex-row sm:items-center justify-between pb-4 border-b gap-2">
          <div>
            <span class="text-xs font-semibold px-2.5 py-0.5 rounded bg-purple-100 text-purple-800">${vote.chamber} Roll Call #${vote.roll_call_number}</span>
            <h3 class="font-bold text-lg text-gray-900 mt-1">${vote.question || 'Legislative Vote'}</h3>
          </div>
          <div class="text-right">
            <span class="inline-block px-3 py-1 text-xs font-bold rounded ${vote.result === 'Passed' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}">${vote.result}</span>
            <p class="text-xs text-gray-400 mt-1">Date: ${vote.date || 'N/A'}</p>
          </div>
        </div>
        <div class="grid grid-cols-3 gap-4 my-4 text-center">
          <div class="bg-green-50 p-3 rounded-lg border border-green-100">
            <p class="text-xs text-green-600 font-semibold uppercase">Yeas</p>
            <p class="text-xl font-bold text-green-700">${tallies.yea || 0}</p>
          </div>
          <div class="bg-red-50 p-3 rounded-lg border border-red-100">
            <p class="text-xs text-red-600 font-semibold uppercase">Nays</p>
            <p class="text-xl font-bold text-red-700">${tallies.nay || 0}</p>
          </div>
          <div class="bg-gray-50 p-3 rounded-lg border border-gray-200">
            <p class="text-xs text-gray-500 font-semibold uppercase">Not Voting</p>
            <p class="text-xl font-bold text-gray-700">${tallies.not_voting || 0}</p>
          </div>
        </div>
      </div>
    `;
  });
  html += '</div>';
  container.innerHTML = html;
}

function renderMembers() {
  const container = document.getElementById('members-container');
  if (allMembers.length === 0) {
    container.innerHTML = `<p class="text-center text-gray-500 py-12">No members found for this state. Ensure your ingestion script has synced members.</p>`;
    return;
  }

  let html = '<div class="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">';
  allMembers.forEach(member => {
    html += `
      <div class="border rounded-xl p-5 shadow-sm bg-white flex items-center space-x-4">
        <img src="${member.imageUrl}" alt="${member.name}" class="w-16 h-20 object-cover rounded-lg bg-gray-100 border" onerror="this.src='https://via.placeholder.com/150?text=No+Photo'" />
        <div>
          <span class="text-xs font-semibold px-2 py-0.5 rounded ${member.party === 'Democratic' ? 'bg-blue-100 text-blue-800' : member.party === 'Republican' ? 'bg-red-100 text-red-800' : 'bg-gray-100 text-gray-800'}">${member.party || 'Independent'}</span>
          <h4 class="font-bold text-base text-gray-900 mt-1">${member.name}</h4>
          <p class="text-xs text-gray-500 mt-0.5">${member.chamber} • ${member.state} ${member.district ? `(District ${member.district})` : ''}</p>
        </div>
      </div>
    `;
  });
  html += '</div>';
  container.innerHTML = html;
}

// --- EVENT LISTENERS ---
function setupEventListeners() {
  // Search
  document.getElementById('search-input').addEventListener('input', (e) => {
    searchQuery = e.target.value.trim();
    renderBills();
  });

  // Category filters
  const filterButtons = document.querySelectorAll('.filter-btn');
  filterButtons.forEach(btn => {
    btn.addEventListener('click', (e) => {
      filterButtons.forEach(b => {
        b.classList.remove('bg-blue-600', 'text-white');
        b.classList.add('bg-gray-200', 'text-gray-700');
      });
      e.target.classList.remove('bg-gray-200', 'text-gray-700');
      e.target.classList.add('bg-blue-600', 'text-white');

      currentCategory = e.target.getAttribute('data-category');
      renderBills();
    });
  });

  // State dropdown change
  document.getElementById('state-select').addEventListener('change', async (e) => {
    const selectedState = e.target.value;
    await loadMembersData(selectedState);
  });
}

initApp();