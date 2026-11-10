// app.js - Client-side state and Firestore querying logic

let currentChamber = 'All';
let currentTopic = 'All';

// Wait for DOM and Firebase initialization
document.addEventListener('DOMContentLoaded', () => {
  // Give Firebase module script a moment to mount on window
  setTimeout(() => {
    fetchBills();
  }, 300);
});

// UI Event Handlers
window.setChamber = function(chamber) {
  currentChamber = chamber;
  ['All', 'Senate', 'House'].forEach(c => {
    const btn = document.getElementById(`btn-chamber-${c.toLowerCase()}`);
    if (btn) {
      btn.className = (c === chamber)
        ? "px-4 py-1.5 text-sm font-medium rounded-md bg-white shadow-sm text-gray-900 transition"
        : "px-4 py-1.5 text-sm font-medium rounded-md text-gray-600 hover:text-gray-900 transition";
    }
  });
  fetchBills();
};

window.setTopic = function(topic) {
  currentTopic = topic;
  document.querySelectorAll('.topic-btn').forEach(btn => {
    const btnTopic = btn.getAttribute('data-topic');
    btn.className = (btnTopic === topic)
      ? "topic-btn px-3 py-1 text-xs font-medium rounded-full bg-blue-600 text-white transition"
      : "topic-btn px-3 py-1 text-xs font-medium rounded-full bg-gray-100 text-gray-700 hover:bg-gray-200 transition";
  });
  fetchBills();
};

// Fetch & Render Bills from Firestore
async function fetchBills() {
  const container = document.getElementById('bills-container');
  if (!container || !window.db) return;

  // Render Loading Spinner
  container.innerHTML = `
    <div class="bg-white rounded-xl shadow-sm border border-gray-200 p-8 text-center text-gray-500">
      <svg class="animate-spin h-6 w-6 mx-auto mb-3 text-blue-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
        <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
        <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
      </svg>
      <p class="text-sm">Loading congressional votes...</p>
    </div>
  `;

  try {
    const { collection, getDocs } = await import("https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js");
    
    // Query bills collection
    const querySnapshot = await getDocs(collection(window.db, "bills"));
    let bills = [];
    querySnapshot.forEach(doc => {
      bills.push(doc.data());
    });

    // Client-side filtering
    if (currentChamber !== 'All') {
      bills = bills.filter(b => b.chamber.toLowerCase() === currentChamber.toLowerCase());
    }
    if (currentTopic !== 'All') {
      bills = bills.filter(b => b.category === currentTopic);
    }

    // Sort by most recent
    bills.sort((a, b) => new Date(b.date_voted) - new Date(a.date_voted));

    if (bills.length === 0) {
      container.innerHTML = `
        <div class="bg-white rounded-xl shadow-sm border border-gray-200 p-8 text-center text-gray-500">
          <p class="text-base font-semibold text-gray-700">No recent votes found</p>
          <p class="text-xs text-gray-400 mt-1">Try broadening your chamber or topic filters, or run the sync function.</p>
        </div>
      `;
      return;
    }

    // Render Bill Cards
    container.innerHTML = bills.map(bill => renderBillCard(bill)).join('');

  } catch (err) {
    console.error("Error fetching bills:", err);
    container.innerHTML = `
      <div class="bg-red-50 rounded-xl border border-red-200 p-6 text-center text-red-700">
        <p class="font-semibold text-sm">Failed to load data from Cloud Firestore.</p>
        <p class="text-xs mt-1 text-red-500">${err.message}</p>
      </div>
    `;
  }
}

// Card Renderer Component
function renderBillCard(bill) {
  const categoryColors = {
    'Healthcare': 'bg-emerald-50 text-emerald-700 border-emerald-200',
    'Economy': 'bg-blue-50 text-blue-700 border-blue-200',
    'Foreign Affairs': 'bg-purple-50 text-purple-700 border-purple-200'
  };

  const badgeClass = categoryColors[bill.category] || 'bg-gray-50 text-gray-700 border-gray-200';
  const outcomeColor = bill.outcome === 'Passed' ? 'text-green-600' : 'text-red-600';

  const bullets = bill.ai_summary?.bullet_points || ["No summary available."];

  return `
    <div class="bg-white rounded-xl shadow-sm border border-gray-200 p-6 transition hover:shadow-md">
      <div class="flex flex-col md:flex-row md:items-center justify-between gap-2 mb-3">
        <div class="flex items-center space-x-2">
          <span class="px-2.5 py-0.5 rounded-full text-xs font-semibold border ${badgeClass}">
            ${bill.category}
          </span>
          <span class="text-xs font-medium text-gray-400">
            ${bill.chamber} &bull; ${bill.bill_number}
          </span>
        </div>
        <div class="text-xs font-semibold ${outcomeColor}">
          ${bill.outcome} (${bill.vote_counts?.yea || 0} Yea - ${bill.vote_counts?.nay || 0} Nay)
        </div>
      </div>

      <h2 class="text-lg font-bold text-gray-900 mb-2 leading-snug">
        ${bill.title}
      </h2>

      <!-- AI Non-Partisan Impact Summary -->
      <div class="bg-slate-50 rounded-lg p-4 my-4 border border-slate-100">
        <div class="flex items-center space-x-2 mb-2">
          <span class="text-xs font-bold uppercase tracking-wider text-slate-500">Key Practical Takeaways</span>
          <span class="text-[10px] bg-slate-200 text-slate-600 px-1.5 py-0.5 rounded font-mono">AI Neutral Summary</span>
        </div>
        <ul class="space-y-1.5 text-sm text-slate-700 list-disc list-inside">
          ${bullets.map(pt => `<li>${pt}</li>`).join('')}
        </ul>
      </div>

      <div class="flex items-center justify-between pt-2 text-xs text-gray-400 border-t border-gray-100">
        <span>Voted on: ${bill.date_voted}</span>
        <button onclick="toggleMemberVotes('${bill.bill_id}')" class="text-blue-600 hover:text-blue-800 font-medium transition">
          View Roll Call Breakdown &rarr;
        </button>
      </div>

      <div id="rollcall-${bill.bill_id}" class="hidden mt-4 pt-4 border-t border-gray-100 text-xs text-gray-600">
        <p class="italic text-gray-400">Loading member positions...</p>
      </div>
    </div>
  `;
}

window.toggleMemberVotes = async function(billId) {
  const el = document.getElementById(`rollcall-${billId}`);
  if (!el) return;

  if (!el.classList.contains('hidden')) {
    el.classList.add('hidden');
    return;
  }

  el.classList.remove('hidden');
  
  try {
    const { doc, getDoc } = await import("https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js");
    const docSnap = await getDoc(doc(window.db, "votes", billId));
    
    if (docSnap.exists()) {
      const data = docSnap.data();
      const positions = data.positions || {};
      const memberIds = Object.keys(positions);

      if (memberIds.length === 0) {
        el.innerHTML = `<p class="text-gray-400">No member breakdown recorded for this vote.</p>`;
        return;
      }

      el.innerHTML = `
        <div class="bg-gray-50 rounded-lg p-3 max-h-48 overflow-y-auto">
          <div class="font-semibold text-gray-700 mb-2">Recorded Votes (${memberIds.length} members):</div>
          <div class="grid grid-cols-2 md:grid-cols-4 gap-2">
            ${memberIds.slice(0, 40).map(id => `
              <div class="flex justify-between bg-white px-2 py-1 rounded border border-gray-200">
                <span class="font-mono text-gray-500">${id}</span>
                <span class="font-bold ${positions[id] === 'YEA' ? 'text-green-600' : 'text-red-600'}">${positions[id]}</span>
              </div>
            `).join('')}
          </div>
          ${memberIds.length > 40 ? `<p class="text-[10px] text-gray-400 mt-2 text-center">+ ${memberIds.length - 40} more members recorded</p>` : ''}
        </div>
      `;
    } else {
      el.innerHTML = `<p class="text-gray-400">Roll call details pending sync.</p>`;
    }
  } catch (err) {
    el.innerHTML = `<p class="text-red-500">Error loading roll call data.</p>`;
  }
};