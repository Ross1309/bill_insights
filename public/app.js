import { initializeApp } from "https://www.gstatic.com/firebasejs/13.2.0/firebase-app.js";
import { getFirestore, collection, getDocs, query, limit } from "https://www.gstatic.com/firebasejs/13.2.0/firebase-firestore.js";

const firebaseConfig = {
    apiKey: "AIzaSyB53n86BTG9co1S8Ek0Acvx4onbzvXQD8Y",
    authDomain: "congress-watcher-b0dd3.firebaseapp.com",
    projectId: "congress-watcher-b0dd3",
    storageBucket: "congress-watcher-b0dd3.firebasestorage.app",
    messagingSenderId: "775303136240",
    appId: "1:775303136240:web:ab13bd736700a29cfe5335"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function loadBills() {
  const container = document.getElementById('bills-container') || document.body;
  
  try {
    const billsQuery = query(collection(db, "bills"), limit(10));
    const querySnapshot = await getDocs(billsQuery);

    if (querySnapshot.empty) {
      container.innerHTML = `<p class="text-center text-gray-500 py-8">No bills found in database.</p>`;
      return;
    }

    let html = '<div class="grid gap-6 md:grid-cols-2 lg:grid-cols-3 p-4">';
    querySnapshot.forEach((doc) => {
      const bill = doc.data();
      const bullets = bill.ai_summary?.bullet_points || [];

      html += `
        <div class="border rounded-xl p-5 shadow-sm bg-white flex flex-col justify-between">
          <div>
            <div class="flex justify-between items-center mb-2">
              <span class="text-xs font-semibold px-2.5 py-0.5 rounded bg-blue-100 text-blue-800">${bill.category || 'General'}</span>
              <span class="text-xs text-gray-500">${bill.bill_number || ''}</span>
            </div>
            <h3 class="font-bold text-lg mb-3 text-gray-900">${bill.title}</h3>
            <ul class="list-disc list-inside text-sm text-gray-600 space-y-1 mb-4">
              ${bullets.map(b => `<li>${b}</li>`).join('')}
            </ul>
          </div>
          <div class="text-xs text-gray-400 border-t pt-3 flex justify-between">
            <span>Chamber: ${bill.chamber}</span>
            <span>Date: ${bill.date_voted}</span>
          </div>
        </div>
      `;
    });
    html += '</div>';

    container.innerHTML = html;

  } catch (err) {
    console.error("Error loading bills from Firestore:", err);
    container.innerHTML = `<p class="text-center text-red-500 py-8">Failed to load bills: ${err.message}</p>`;
  }
}

loadBills();