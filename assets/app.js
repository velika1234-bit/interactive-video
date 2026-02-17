// assets/app.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import {
  getFirestore, collection, doc, setDoc, getDoc, addDoc, updateDoc, deleteDoc,
  onSnapshot, serverTimestamp, getDocs
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import {
  getAuth, onAuthStateChanged, signOut, signInAnonymously,
  createUserWithEmailAndPassword, signInWithEmailAndPassword
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

/* ------------------ CONFIG ------------------ */
const firebaseConfig = {
  apiKey: "AIzaSyA0WhbnxygznaGCcdxLBHweZZThezUO314",
  authDomain: "videoquiz-ultimate.firebaseapp.com",
  projectId: "videoquiz-ultimate",
  storageBucket: "videoquiz-ultimate.firebasestorage.app",
  messagingSenderId: "793138692820",
  appId: "1:793138692820:web:8ee2418d28d47fca6bf141"
};
const APP_ID = "videoquiz-ultimate-live";

// Registration code (ти можеш да го смениш)
const TEACHER_REG_CODE = "vilidaf76";

/* ------------------ INIT ------------------ */
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

/* ------------------ DOM helpers ------------------ */
const $ = (id) => document.getElementById(id);
const safeIcons = () => { try { window.lucide?.createIcons?.(); } catch {} };

const toast = (text, type="info") => {
  const c = $("msg-container");
  if (!c) return;
  const el = document.createElement("div");
  const bg = type === "error" ? "bg-rose-600" : type === "success" ? "bg-emerald-600" : "bg-brand-600";
  el.className = `pointer-events-none ${bg} text-white font-black text-sm px-4 py-3 rounded-xl shadow-lg animate-pop`;
  el.textContent = text;
  c.appendChild(el);
  setTimeout(() => el.remove(), 2800);
};

const showModal = (id) => { const m=$(id); m.classList.remove("hidden"); m.classList.add("flex"); safeIcons(); };
const closeModal = (id) => { const m=$(id); m.classList.add("hidden"); m.classList.remove("flex"); };

/* ------------------ Screen switching ------------------ */
const screens = ["welcome","teacher","editor","host","client","solo","finish"];
const switchScreen = (name) => {
  for (const s of screens) $("screen-"+s)?.classList.add("hidden");
  $("screen-"+name)?.classList.remove("hidden");
  safeIcons();
  window.scrollTo(0,0);
};

/* ------------------ Firestore paths ------------------ */
const userProfileRef = (uid) => doc(db, "artifacts", APP_ID, "users", uid, "settings", "profile");
const lessonsCol = (uid) => collection(db, "artifacts", APP_ID, "users", uid, "my_quizzes");
const soloResultsCol = (uid) => collection(db, "artifacts", APP_ID, "users", uid, "solo_results");
const classHistoryCol = (uid) => collection(db, "artifacts", APP_ID, "users", uid, "class_history");

const sessionRef = (pin) => doc(db, "artifacts", APP_ID, "public", "data", "sessions", pin);
const participantsCol = (pin) => collection(db, "artifacts", APP_ID, "public", "data", "sessions", pin, "participants");
const participantRef = (pin, pid) => doc(db, "artifacts", APP_ID, "public", "data", "sessions", pin, "participants", pid);

/* ------------------ Encoding helpers ------------------ */
const encodeLessonCode = (obj) => btoa(unescape(encodeURIComponent(JSON.stringify(obj))));
const decodeLessonCode = (code) => {
  try {
    const clean = String(code||"").trim().replace(/\s/g,"");
    return JSON.parse(decodeURIComponent(escape(atob(clean))));
  } catch { return null; }
};

const ytIdFromUrl = (url) => {
  const m = String(url||"").match(/(?:youtu\.be\/|youtube\.com(?:\/embed\/|\/v\/|\/watch\?v=|\/watch\?.+&v=))([\w-]{11})/);
  return m?.[1] || null;
};

const fmtTime = (s) => {
  const m=Math.floor(s/60), ss=Math.floor(s%60);
  return `${m}:${ss<10?"0":""}${ss}`;
};
const fmtDate = (ts) => {
  if (!ts) return "";
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleString("bg-BG");
};
const maxPoints = (qs=[]) => qs.reduce((a,q)=>a+(Number(q.points)||1),0);

/* ------------------ Global state ------------------ */
let user = null;
let teacherMode = "login"; // login/register
let myLessons = [];
let soloHistory = [];
let classHistory = [];

let editor = {
  id: null, // null=new, else existing doc id
  title: "Без име",
  videoId: "",
  questions: [],
  player: null,
  timerInt: null,
  editingIndex: null
};

let solo = {
  player: null,
  quiz: null,
  qIndex: -1,
  selected: null,
  selectedMulti: new Set(),
  orderPick: [],
  score: 0,
  finished: false,
  sop: false,
  discussion: false,
  studentName: ""
};

let live = {
  pin: "",
  quiz: null,          // {title, videoId, questions}
  hostPlayer: null,
  activeQ: -1,
  interval: null,
  parts: [],
  myScore: 0,
  myAvatar: "😎",
  myName: "",
  currentQ: null,
  lastAnsweredQ: -1,
  lastViewedSession: { id:null, title:"", rows:[] }
};

const AVATARS = ["🐶","🐱","🐭","🐹","🐰","🦊","🐻","🐼","🐨","🐯","🦁","🐮","🐷","🐸","🐵"];

/* ------------------ YouTube readiness ------------------ */
let YTReady = false;
window.onYouTubeIframeAPIReady = () => { YTReady = true; };

/* ------------------ AUTH ------------------ */
const setAuthMode = (mode) => {
  teacherMode = mode;
  $("auth-title").textContent = mode==="login" ? "Учителски вход" : "Регистрация";
  $("auth-btn").textContent = mode==="login" ? "ВЛЕЗ" : "РЕГИСТРАЦИЯ";
  $("teacher-code-wrap").classList.toggle("hidden", mode!=="register");
  $("auth-toggle").textContent = mode==="login" ? "Нямате акаунт? Регистрация" : "Имате акаунт? Вход";
};

$("auth-toggle")?.addEventListener("click", () => setAuthMode(teacherMode==="login" ? "register" : "login"));

const ensureTeacherProfile = async (u) => {
  const ref = userProfileRef(u.uid);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    await setDoc(ref, {
      role: "teacher",
      email: u.email || "",
      emailNormalized: (u.email || "").toLowerCase(),
      createdAt: serverTimestamp()
    }, { merge:true });
  } else {
    // If role missing, set it (safe)
    const data = snap.data() || {};
    if (data.role !== "teacher") {
      await setDoc(ref, { role:"teacher" }, { merge:true });
    }
  }
};

const authSubmit = async () => {
  const email = $("auth-email").value.trim();
  const pass = $("auth-pass").value;
  if (!email || !pass) return toast("Попълни имейл и парола", "error");

  try {
    if (teacherMode === "register") {
      const code = $("teacher-code").value.trim();
      if (code !== TEACHER_REG_CODE) return toast("Грешен код за регистрация", "error");
      const cred = await createUserWithEmailAndPassword(auth, email, pass);
      await ensureTeacherProfile(cred.user);
      toast("Регистрация успешна!", "success");
    } else {
      await signInWithEmailAndPassword(auth, email, pass);
      toast("Вход успешен!", "success");
    }
  } catch (e) {
    toast("Грешка: " + (e?.message || "unknown"), "error");
  }
};

const logout = async () => {
  await signOut(auth);
  location.href = location.pathname;
};

/* ------------------ TEACHER: load/render ------------------ */
const loadTeacherData = () => {
  if (!user) return;

  $("teacher-email").textContent = user.email || user.uid;

  onSnapshot(lessonsCol(user.uid), (snap) => {
    myLessons = snap.docs.map(d => ({ id:d.id, ...d.data() }));
    renderLessons();
  });

  onSnapshot(soloResultsCol(user.uid), (snap) => {
    soloHistory = snap.docs.map(d => ({ id:d.id, ...d.data() }));
    renderSoloHistory();
  });

  onSnapshot(classHistoryCol(user.uid), (snap) => {
    classHistory = snap.docs.map(d => ({ id:d.id, ...d.data() }));
    renderClassHistory();
  });
};

const renderLessons = () => {
  const c = $("lessons-list");
  if (!c) return;

  c.innerHTML = myLessons.map(l => `
    <div class="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 flex flex-col justify-between">
      <div>
        <h3 class="font-black text-slate-900 text-lg line-clamp-2">${escapeHtml(l.title || "Без име")}</h3>
        <p class="text-[10px] uppercase font-black text-slate-400 mt-2">${(l.questions?.length||0)} въпроса</p>
      </div>

      <div class="mt-4 grid grid-cols-4 gap-2">
        <button class="col-span-2 py-2 rounded-xl bg-brand-600 hover:bg-brand-700 text-white font-black text-xs flex items-center justify-center gap-2"
          onclick="window.VQ.hostStart('${l.id}')">
          <i data-lucide="play" class="w-4 h-4"></i> Старт
        </button>

        <button class="py-2 rounded-xl bg-amber-50 hover:bg-amber-100 text-amber-700 font-black text-xs"
          onclick="window.VQ.share('${l.id}')">
          <i data-lucide="share-2" class="w-4 h-4 inline"></i>
        </button>

        <button class="py-2 rounded-xl bg-slate-50 hover:bg-slate-100 text-slate-700 font-black text-xs"
          onclick="window.VQ.editLesson('${l.id}')">
          <i data-lucide="pencil" class="w-4 h-4 inline"></i>
        </button>
      </div>

      <button class="mt-2 py-2 rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-700 font-black text-xs"
        onclick="window.VQ.deleteLesson('${l.id}')">
        <i data-lucide="trash-2" class="w-4 h-4 inline"></i> Изтрий
      </button>
    </div>
  `).join("");

  safeIcons();
};

const escapeHtml = (s) => String(s||"").replace(/[&<>"']/g, (m) => ({
  "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
}[m]));

/* ------------------ HISTORY tabs ------------------ */
let histTab = "solo";
const switchHist = (tab) => {
  histTab = tab;
  $("tab-solo").className = tab==="solo" ? "px-4 py-2 rounded-lg font-bold text-xs bg-brand-600 text-white" : "px-4 py-2 rounded-lg font-bold text-xs text-slate-600 hover:bg-slate-50";
  $("tab-class").className = tab==="class" ? "px-4 py-2 rounded-lg font-bold text-xs bg-brand-600 text-white" : "px-4 py-2 rounded-lg font-bold text-xs text-slate-600 hover:bg-slate-50";
  $("hist-solo").classList.toggle("hidden", tab!=="solo");
  $("hist-class").classList.toggle("hidden", tab!=="class");
};

const renderSoloHistory = () => {
  const b = $("solo-body");
  if (!b) return;
  const s = [...soloHistory].sort((a,b)=>toMs(b.timestamp)-toMs(a.timestamp));
  b.innerHTML = s.map(r => `
    <tr class="text-xs hover:bg-slate-50">
      <td class="p-4 pl-6 font-bold">${escapeHtml(r.studentName||"-")}</td>
      <td class="p-4 text-slate-600">${escapeHtml(r.quizTitle||"-")}</td>
      <td class="p-4 text-slate-500 font-mono">${fmtDate(r.timestamp)}</td>
      <td class="p-4 text-right"><span class="px-2.5 py-1 rounded-lg bg-brand-100 text-brand-700 font-black">${escapeHtml(r.score||"")}</span></td>
      <td class="p-4 text-center">
        <button class="p-2 rounded-lg hover:bg-rose-50 text-rose-600" onclick="window.VQ.deleteSolo('${r.id}')">
          <i data-lucide="trash-2" class="w-4 h-4"></i>
        </button>
      </td>
    </tr>
  `).join("");
  safeIcons();
};

const renderClassHistory = () => {
  const b = $("class-body");
  const empty = $("class-empty");
  if (!b || !empty) return;
  if (!classHistory.length) { b.innerHTML=""; empty.classList.remove("hidden"); return; }
  empty.classList.add("hidden");

  const s = [...classHistory].sort((a,b)=>toMs(b.timestamp)-toMs(a.timestamp));
  b.innerHTML = s.map(r => `
    <tr class="text-xs hover:bg-slate-50">
      <td class="p-4 pl-6 text-slate-500 font-mono">${fmtDate(r.timestamp)}</td>
      <td class="p-4 font-bold">${escapeHtml(r.quizTitle||"")}</td>
      <td class="p-4 text-slate-600 font-mono">${escapeHtml(r.pin||"")}</td>
      <td class="p-4 text-center">
        <button class="px-3 py-1 rounded-lg bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-black text-[10px]"
          onclick="window.VQ.viewClass('${r.sessionId}','${escapeHtml(r.quizTitle||"")}', '${escapeHtml(r.pin||"")}')">
          Виж
        </button>
      </td>
      <td class="p-4 text-center">
        <button class="p-2 rounded-lg hover:bg-rose-50 text-rose-600" onclick="window.VQ.deleteClass('${r.id}','${r.sessionId}')">
          <i data-lucide="trash-2" class="w-4 h-4"></i>
        </button>
      </td>
    </tr>
  `).join("");
  safeIcons();
};

const toMs = (ts) => ts?.toMillis ? ts.toMillis() : ts?.seconds ? ts.seconds*1000 : 0;

const deleteSolo = async (id) => {
  if (!confirm("Да изтрия резултата?")) return;
  await deleteDoc(doc(soloResultsCol(user.uid), id));
};

const deleteClass = async (historyId, sessionId) => {
  if (!confirm("Това ще изтрие историята и участниците за тази сесия. Продължаваме?")) return;
  await deleteDoc(doc(classHistoryCol(user.uid), historyId));
  try {
    await deleteDoc(sessionRef(sessionId));
    const snap = await getDocs(participantsCol(sessionId));
    for (const d of snap.docs) await deleteDoc(d.ref);
  } catch {}
  toast("Сесията е изтрита.", "success");
};

const exportSoloExcel = () => {
  const rows = [...soloHistory].map(r => ({
    Ученик: r.studentName || "",
    Урок: r.quizTitle || "",
    Дата: fmtDate(r.timestamp),
    Резултат: r.score || ""
  }));
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Solo");
  XLSX.writeFile(wb, `Solo_Results.xlsx`);
};

/* ------------------ CLASS RESULTS modal + export ------------------ */
const viewClass = async (sessionId, quizTitle, pin) => {
  live.lastViewedSession = { id: sessionId, title: quizTitle, rows: [] };
  $("mc-title").textContent = `${quizTitle} (ПИН ${pin})`;
  $("mc-body").innerHTML = `<tr><td colspan="2" class="p-6 text-center text-slate-400 font-bold">Зареждане…</td></tr>`;
  showModal("modal-class");

  try {
    const snap = await getDocs(participantsCol(sessionId));
    const parts = snap.docs.map(d => d.data()).sort((a,b)=>(b.score||0)-(a.score||0));
    live.lastViewedSession.rows = parts.map(p => ({ name:p.name||"-", score:p.score||0, avatar:p.avatar||"👤" }));

    if (!parts.length) {
      $("mc-body").innerHTML = `<tr><td colspan="2" class="p-8 text-center text-slate-400 italic">Няма участници.</td></tr>`;
      return;
    }

    $("mc-body").innerHTML = parts.map(p => `
      <tr>
        <td class="p-4 pl-6 font-bold flex items-center gap-2"><span class="text-xl">${p.avatar||"👤"}</span>${escapeHtml(p.name||"-")}</td>
        <td class="p-4 text-right font-black text-brand-700">${p.score||0}</td>
      </tr>
    `).join("");
  } catch {
    $("mc-body").innerHTML = `<tr><td colspan="2" class="p-6 text-center text-rose-600 font-bold">Грешка при зареждане.</td></tr>`;
  }
};

const exportClassExcel = () => {
  if (!live.lastViewedSession.id) return toast("Няма заредена сесия", "error");
  const ws = XLSX.utils.json_to_sheet(live.lastViewedSession.rows.map(r => ({ Ученик: r.name, Точки: r.score })));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Class");
  XLSX.writeFile(wb, `Class_${live.lastViewedSession.id}.xlsx`);
};

const exportClassPDF = () => {
  if (!live.lastViewedSession.id) return toast("Няма заредена сесия", "error");
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();
  doc.text(`Резултати: ${live.lastViewedSession.title}`, 10, 10);
  doc.autoTable({
    head: [["Ученик","Точки"]],
    body: live.lastViewedSession.rows.map(r => [r.name, String(r.score)])
  });
  doc.save(`Class_${live.lastViewedSession.id}.pdf`);
};

/* ------------------ LESSON CRUD ------------------ */
const newLesson = () => {
  editor.id = null;
  editor.title = "Без име";
  editor.videoId = "";
  editor.questions = [];
  editor.editingIndex = null;

  $("editor-title").textContent = "Нов урок";
  $("yt-url").value = "";
  $("editor-video-wrap").innerHTML = "";
  $("editor-video-overlay").classList.remove("hidden");
  renderQList();
  switchScreen("editor");
};

const editLesson = (id) => {
  const l = myLessons.find(x=>x.id===id);
  if (!l) return;
  editor.id = id;
  editor.title = l.title || "Без име";
  editor.videoId = l.videoId || l.v || "";
  editor.questions = (l.questions || l.q || []).map(q => ({...q}));
  editor.editingIndex = null;

  $("editor-title").textContent = "Редакция: " + editor.title;
  $("yt-url").value = editor.videoId ? `https://youtu.be/${editor.videoId}` : "";
  $("editor-video-overlay").classList.toggle("hidden", !!editor.videoId);

  mountEditorPlayer();
  renderQList();
  switchScreen("editor");
};

const deleteLesson = async (id) => {
  if (!confirm("Да изтрия урока?")) return;
  await deleteDoc(doc(lessonsCol(user.uid), id));
  toast("Изтрито.", "success");
};

const loadEditorVideo = () => {
  const id = ytIdFromUrl($("yt-url").value);
  if (!id) return toast("Невалиден YouTube линк", "error");
  editor.videoId = id;
  $("editor-video-overlay").classList.add("hidden");
  mountEditorPlayer(true);
  toast("Видео заредено.", "success");
};

const mountEditorPlayer = (autoplay=false) => {
  if (!YTReady) { toast("YouTube API още зарежда… пробвай пак след 2 сек.", "error"); return; }
  $("editor-video-wrap").innerHTML = `<div id="editor-player" class="w-full h-full"></div>`;
  editor.player = new YT.Player("editor-player", {
    videoId: editor.videoId,
    playerVars: { autoplay: autoplay?1:0, controls: 1 },
    events: {
      onReady: () => {
        clearInterval(editor.timerInt);
        editor.timerInt = setInterval(() => {
          try{
            const t = Math.floor(editor.player.getCurrentTime());
            $("editor-timer").textContent = fmtTime(t);
          }catch{}
        }, 400);
      }
    }
  });
};

const saveLesson = async () => {
  if (!user) return toast("Нямаш учителски вход", "error");
  if (!editor.videoId) return toast("Липсва видео", "error");

  const title = prompt("Име на урока:", editor.title || "Без име");
  if (title === null) return; // cancel
  editor.title = title.trim() || "Без име";

  const payload = {
    title: editor.title,
    videoId: editor.videoId,
    questions: editor.questions,
    updatedAt: serverTimestamp(),
    ownerId: user.uid
  };

  try {
    if (editor.id) {
      await updateDoc(doc(lessonsCol(user.uid), editor.id), payload);
      toast("Урокът е обновен!", "success");
    } else {
      payload.createdAt = serverTimestamp();
      const ref = await addDoc(lessonsCol(user.uid), payload);
      editor.id = ref.id;
      toast("Урокът е записан!", "success");
    }
    switchScreen("teacher");
  } catch (e) {
    toast("Грешка при запис: " + (e?.message||""), "error");
  }
};

/* ------------------ Question modal (add/edit) ------------------ */
const openQuestionModal = () => {
  if (!editor.player) return toast("Първо зареди видео", "error");

  editor.editingIndex = null;
  const t = Math.floor(editor.player.getCurrentTime());
  $("mq-title").textContent = "Нов въпрос";
  $("mq-text").value = "";
  $("mq-type").value = "single";
  $("mq-points").value = 1;
  $("mq-time").value = t;
  renderModalFields();
  showModal("modal-q");
};

const editQuestionAt = (idx) => {
  const q = editor.questions[idx];
  if (!q) return;
  editor.editingIndex = idx;
  $("mq-title").textContent = "Редакция на въпрос";
  $("mq-text").value = q.text || "";
  $("mq-type").value = q.type || "single";
  $("mq-points").value = q.points || 1;
  $("mq-time").value = q.time || 0;
  renderModalFields(q);
  showModal("modal-q");
};

const bumpTime = (delta) => {
  const v = Number($("mq-time").value) || 0;
  $("mq-time").value = Math.max(0, v + delta);
};

const renderModalFields = (existing=null) => {
  const type = $("mq-type").value;
  const box = $("mq-dynamic");
  box.innerHTML = "";

  const makeOptRow = (val="") => `
    <div class="flex gap-2 items-center">
      <input class="opt w-full p-3 rounded-xl border border-slate-200 font-bold bg-slate-50" value="${escapeHtml(val)}" placeholder="Отговор" />
    </div>
  `;

  if (type === "single" || type === "multiple" || type === "ordering") {
    const opts = existing?.options?.length ? existing.options : ["","", "", ""];
    box.innerHTML = `
      <div class="space-y-2">
        <div class="text-xs font-black text-slate-500 uppercase">Отговори</div>
        ${opts.map(o=>makeOptRow(o)).join("")}
        <button class="mt-2 px-3 py-2 rounded-xl border border-slate-200 font-black text-xs hover:bg-slate-50"
          onclick="window.VQ.addOptRow()">+ Отговор</button>
      </div>
      <div class="mt-4 p-4 rounded-2xl bg-slate-50 border border-slate-200">
        ${type==="single" ? `<div class="text-xs font-black text-slate-500 uppercase mb-2">Верен отговор (индекс)</div>
          <input id="mq-correct-single" type="number" min="0" value="${Number(existing?.correct ?? 0)}"
            class="w-full p-3 rounded-xl border border-slate-200 font-bold bg-white" />
          <p class="text-xs text-slate-500 font-bold mt-2">0 = първи, 1 = втори и т.н.</p>
        ` : type==="multiple" ? `<div class="text-xs font-black text-slate-500 uppercase mb-2">Верни индекси</div>
          <input id="mq-correct-multi" value="${(existing?.correctMulti||[]).join(",")}" class="w-full p-3 rounded-xl border border-slate-200 font-bold bg-white" placeholder="пример: 0,2" />
          <p class="text-xs text-slate-500 font-bold mt-2">Запиши индекси с запетая. Пример: 0,2</p>
        ` : `<div class="text-xs font-black text-slate-500 uppercase mb-2">Правилен ред</div>
          <p class="text-xs text-slate-600 font-bold">За „Подреждане“ правилният ред е както си подредиш опциите тук.</p>`
        }
      </div>
    `;
  }

  if (type === "boolean") {
    const cor = !!existing?.correct;
    box.innerHTML = `
      <div class="p-4 rounded-2xl bg-slate-50 border border-slate-200">
        <div class="text-xs font-black text-slate-500 uppercase mb-2">Верен отговор</div>
        <div class="flex gap-3">
          <label class="flex-1 p-3 rounded-xl border border-slate-200 bg-white font-black text-center cursor-pointer">
            <input type="radio" name="mq-bool" value="true" ${cor?"checked":""}/> ДА
          </label>
          <label class="flex-1 p-3 rounded-xl border border-slate-200 bg-white font-black text-center cursor-pointer">
            <input type="radio" name="mq-bool" value="false" ${!cor?"checked":""}/> НЕ
          </label>
        </div>
      </div>
    `;
  }

  if (type === "numeric_slider" || type === "timeline_slider") {
    box.innerHTML = `
      <div class="grid grid-cols-2 gap-3">
        <input id="mq-min" type="number" class="p-3 rounded-xl border border-slate-200 font-bold bg-slate-50" placeholder="Мин" value="${existing?.min ?? 0}">
        <input id="mq-max" type="number" class="p-3 rounded-xl border border-slate-200 font-bold bg-slate-50" placeholder="Макс" value="${existing?.max ?? 100}">
        <input id="mq-step" type="number" class="p-3 rounded-xl border border-slate-200 font-bold bg-slate-50" placeholder="Стъпка" value="${existing?.step ?? 1}">
        <input id="mq-tol" type="number" class="p-3 rounded-xl border border-slate-200 font-bold bg-slate-50" placeholder="Толеранс" value="${existing?.tolerance ?? 0}">
      </div>
      <div class="mt-3">
        <div class="text-xs font-black text-slate-500 uppercase mb-2">Верен отговор</div>
        <input id="mq-correct-num" type="number" class="w-full p-3 rounded-xl border border-slate-200 font-bold bg-slate-50" value="${existing?.correct ?? 0}">
      </div>
    `;
  }

  safeIcons();
};

const addOptRow = () => {
  const box = $("mq-dynamic");
  const rows = box.querySelectorAll("input.opt");
  // add a new row at end if current block supports it
  const wrapper = document.createElement("div");
  wrapper.innerHTML = `
    <div class="flex gap-2 items-center mt-2">
      <input class="opt w-full p-3 rounded-xl border border-slate-200 font-bold bg-slate-50" value="" placeholder="Отговор" />
    </div>
  `;
  // Insert before the "+ Отговор" button if exists
  const btn = [...box.querySelectorAll("button")].find(b => b.textContent.includes("Отговор"));
  if (btn) btn.parentElement.insertBefore(wrapper.firstElementChild, btn);
  else box.appendChild(wrapper.firstElementChild);
};

const saveQuestion = () => {
  const text = $("mq-text").value.trim();
  if (!text) return toast("Въведи текст на въпроса", "error");

  const type = $("mq-type").value;
  const points = Math.max(1, Number($("mq-points").value)||1);
  const time = Math.max(0, Number($("mq-time").value)||0);

  const q = { text, type, points, time };

  if (type === "single" || type === "multiple" || type === "ordering") {
    const options = [...$("mq-dynamic").querySelectorAll("input.opt")].map(i=>i.value.trim()).filter(Boolean);
    if (options.length < 2) return toast("Добави поне 2 отговора", "error");
    q.options = options;

    if (type === "single") {
      q.correct = Number($("mq-correct-single").value)||0;
    }
    if (type === "multiple") {
      const raw = String($("mq-correct-multi").value||"").trim();
      const arr = raw ? raw.split(",").map(x=>Number(x.trim())).filter(n=>Number.isFinite(n)) : [];
      q.correctMulti = [...new Set(arr)].sort((a,b)=>a-b);
      if (!q.correctMulti.length) return toast("Посочи верни индекси (пример: 0,2)", "error");
    }
    if (type === "ordering") {
      // correct order is the options list order
      q.correctOrder = options;
    }
  }

  if (type === "boolean") {
    const val = document.querySelector('input[name="mq-bool"]:checked')?.value === "true";
    q.correct = val;
  }

  if (type === "numeric_slider" || type === "timeline_slider") {
    q.min = Number($("mq-min").value)||0;
    q.max = Number($("mq-max").value)||100;
    q.step = Number($("mq-step").value)||1;
    q.tolerance = Number($("mq-tol").value)||0;
    q.correct = Number($("mq-correct-num").value)||0;
    if (q.max <= q.min) return toast("Макс трябва да е > Мин", "error");
  }

  if (editor.editingIndex === null) editor.questions.push(q);
  else editor.questions[editor.editingIndex] = q;

  editor.questions.sort((a,b)=>a.time-b.time);
  renderQList();
  closeModal("modal-q");
  toast("Запазено.", "success");
};

const renderQList = () => {
  const c = $("q-list");
  if (!c) return;

  c.innerHTML = editor.questions.map((q,idx)=>`
    <div class="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm">
      <div class="flex items-center justify-between gap-3">
        <div class="flex items-center gap-2">
          <span class="px-2 py-1 rounded-lg bg-brand-100 text-brand-700 font-mono font-black text-xs">${fmtTime(q.time)}</span>
          <div class="font-black text-slate-800 text-sm line-clamp-2">${escapeHtml(q.text)}</div>
        </div>
      </div>
      <div class="mt-3 grid grid-cols-3 gap-2">
        <button class="py-2 rounded-xl bg-slate-50 hover:bg-slate-100 font-black text-xs"
          onclick="window.VQ.jumpTo(${q.time})">Отиди</button>
        <button class="py-2 rounded-xl bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-black text-xs"
          onclick="window.VQ.editQ(${idx})">Редакция</button>
        <button class="py-2 rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-700 font-black text-xs"
          onclick="window.VQ.delQ(${idx})">Изтрий</button>
      </div>
      <div class="mt-2 text-[10px] font-black text-slate-500 uppercase">
        ${escapeHtml(q.type)} • ${q.points} т.
      </div>
    </div>
  `).join("");

  safeIcons();
};

const jumpTo = (sec) => {
  if (!editor.player) return;
  try { editor.player.seekTo(Number(sec)||0, true); editor.player.playVideo(); } catch {}
};

const delQ = (idx) => {
  if (!confirm("Да изтрия въпроса?")) return;
  editor.questions.splice(idx,1);
  renderQList();
};

const openImport = () => { $("import-code").value=""; showModal("modal-import"); };
const submitImport = async () => {
  const dec = decodeLessonCode($("import-code").value);
  if (!dec?.videoId || !Array.isArray(dec.questions)) return toast("Невалиден код", "error");
  await addDoc(lessonsCol(user.uid), {
    title: dec.title || "Import",
    videoId: dec.videoId,
    questions: dec.questions,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    ownerId: user.uid
  });
  closeModal("modal-import");
  toast("Импортирано!", "success");
};

/* ------------------ SHARE code ------------------ */
const share = (lessonId) => {
  const l = myLessons.find(x=>x.id===lessonId);
  if (!l) return;
  const code = encodeLessonCode({
    title: l.title || "Без име",
    videoId: l.videoId || l.v || "",
    questions: l.questions || l.q || [],
    ownerId: user.uid
  });
  $("share-code").value = code;
  showModal("modal-share");
};

const copyShare = async () => {
  const t = $("share-code").value;
  try { await navigator.clipboard.writeText(t); toast("Копирано!", "success"); }
  catch { $("share-code").select(); document.execCommand("copy"); toast("Копирано!", "success"); }
};

/* ------------------ LIVE HOST ------------------ */
const hostStart = async (lessonId) => {
  const l = myLessons.find(x=>x.id===lessonId);
  if (!l) return;

  live.quiz = { title:l.title||"Без име", videoId:(l.videoId||l.v||""), questions:(l.questions||l.q||[]) };
  live.activeQ = -1;
  live.parts = [];

  live.pin = String(Math.floor(1000 + Math.random()*9000));
  $("host-pin").textContent = live.pin;

  // QR
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(location.origin+location.pathname+'?pin='+live.pin)}`;
  $("host-qr").innerHTML = `<img src="${qrUrl}" class="w-32 h-32 rounded-xl border border-slate-200 shadow">`;

  // session doc
  await setDoc(sessionRef(live.pin), {
    pin: live.pin,
    hostId: user.uid,
    quizTitle: live.quiz.title,
    status: "waiting",
    activeQ: -1,
    createdAt: serverTimestamp()
  });

  // watch participants
  onSnapshot(participantsCol(live.pin), (snap) => {
    live.parts = snap.docs.map(d => ({ id:d.id, ...d.data() }));
    renderHostStats();
  });

  // mount host player
  switchScreen("host");
  mountHostPlayer();
};

const mountHostPlayer = () => {
  if (!YTReady) { toast("YouTube API още зарежда…", "error"); return; }
  $("host-video-wrap").innerHTML = `<div id="host-player" class="w-full h-full"></div>`;
  live.hostPlayer = new YT.Player("host-player", {
    videoId: live.quiz.videoId,
    playerVars: { autoplay: 0, controls: 1 },
  });
  $("host-overlay").classList.remove("hidden");
  $("host-q-active").classList.add("hidden");
};

const startHostPlayback = () => {
  $("host-overlay").classList.add("hidden");
  try { live.hostPlayer.playVideo(); } catch {}

  updateDoc(sessionRef(live.pin), { status:"playing" });

  clearInterval(live.interval);
  live.interval = setInterval(async () => {
    if (!live.hostPlayer) return;

    const t = Math.floor(live.hostPlayer.getCurrentTime() || 0);
    const idx = live.quiz.questions.findIndex((q,i) => i>live.activeQ && Math.abs((q.time||0) - t) <= 0);
    if (idx !== -1) {
      live.activeQ = idx;
      try { live.hostPlayer.pauseVideo(); } catch {}
      $("host-q-active").classList.remove("hidden");

      const qData = live.quiz.questions[idx];
      await updateDoc(sessionRef(live.pin), {
        status: "active",
        activeQ: idx,
        qData
      });
      renderHostStats();
    }
  }, 500);
};

const resumeHost = async () => {
  $("host-q-active").classList.add("hidden");
  await updateDoc(sessionRef(live.pin), { status:"playing" });
  try { live.hostPlayer.playVideo(); } catch {}
};

const finishHost = async () => {
  if (!confirm("Край на сесията?")) return;
  try { clearInterval(live.interval); } catch {}
  await updateDoc(sessionRef(live.pin), { status:"finished" });

  // save history entry for teacher
  try {
    await addDoc(classHistoryCol(user.uid), {
      sessionId: live.pin,
      pin: live.pin,
      quizTitle: live.quiz?.title || "Без име",
      timestamp: serverTimestamp()
    });
  } catch {}

  toast("Сесията приключи.", "success");
  switchScreen("teacher");
};

const renderHostStats = () => {
  $("host-count").textContent = String(live.parts.length);

  const sorted = [...live.parts].sort((a,b)=>(b.score||0)-(a.score||0));
  $("host-leader").innerHTML = sorted.map((p,i)=>`
    <tr class="bg-white rounded-xl">
      <td class="p-2 text-xs font-black text-slate-400">#${i+1}</td>
      <td class="p-2 font-bold text-slate-800"><span class="mr-2">${p.avatar||"😎"}</span>${escapeHtml(p.name||"-")}</td>
      <td class="p-2 text-right font-black text-brand-700">${p.score||0}</td>
    </tr>
  `).join("");

  // progress: % answered current q (if active)
  const currentIdx = live.activeQ;
  const total = live.parts.length || 1;
  const answered = live.parts.filter(p => p.answers && p.answers[String(currentIdx)] !== undefined).length;
  const pct = currentIdx >= 0 ? Math.round((answered/total)*100) : 0;
  $("host-progress").style.width = `${pct}%`;
  $("host-progress-text").textContent = `${pct}%`;
  safeIcons();
};

/* ------------------ LIVE CLIENT ------------------ */
const joinLive = async () => {
  const pin = $("live-pin").value.trim();
  const name = $("live-name").value.trim();
  if (!pin || !name) return toast("Попълни име и ПИН", "error");

  if (!auth.currentUser) await signInAnonymously(auth);

  const snap = await getDoc(sessionRef(pin));
  if (!snap.exists()) return toast("Невалиден ПИН", "error");

  live.pin = pin;
  live.myName = name;
  live.myScore = 0;
  live.myAvatar = AVATARS[Math.floor(Math.random()*AVATARS.length)];
  live.lastAnsweredQ = -1;

  $("client-name").textContent = name;
  $("client-avatar").textContent = live.myAvatar;

  await setDoc(participantRef(pin, auth.currentUser.uid), {
    name, avatar: live.myAvatar, score: 0, joinedAt: serverTimestamp(), answers: {}
  }, { merge:true });

  switchScreen("client");
  showClientWait();

  onSnapshot(sessionRef(pin), (s) => {
    const d = s.data();
    if (!d) return;

    if (d.status === "finished") {
      showClientDone();
      return;
    }

    if (d.status === "active" && typeof d.activeQ === "number" && d.activeQ !== live.lastAnsweredQ) {
      live.currentQ = d.qData;
      live.activeQ = d.activeQ;
      showClientQuestion(d.qData);
      return;
    }

    // playing / waiting
    showClientWait();
  });
};

const showClientWait = () => {
  $("client-q").classList.add("hidden");
  $("client-done").classList.add("hidden");
  $("client-wait").classList.remove("hidden");
};

const showClientDone = () => {
  $("client-wait").classList.add("hidden");
  $("client-q").classList.add("hidden");
  $("client-done").classList.remove("hidden");
  $("client-score").textContent = String(live.myScore);
};

const showClientQuestion = (q) => {
  $("client-wait").classList.add("hidden");
  $("client-done").classList.add("hidden");
  $("client-q").classList.remove("hidden");

  $("client-q-text").textContent = q.text || "";
  $("client-confirm").classList.add("hidden");

  live.selected = null;
  live.selectedMulti = new Set();

  const c = $("client-opts");
  c.innerHTML = "";

  if (q.type === "single" || q.type === "boolean") {
    const opts = q.type==="boolean" ? ["ДА","НЕ"] : (q.options||[]);
    c.innerHTML = opts.map((o,i)=>`
      <button class="opt-btn w-full p-4 rounded-2xl border border-slate-200 bg-white font-black text-left hover:bg-brand-50 hover:border-brand-500"
        onclick="window.VQ.pickLive(${q.type==='boolean' ? (i===0) : i}, this)">
        ${escapeHtml(o)}
      </button>
    `).join("");
  } else if (q.type === "multiple") {
    const opts = q.options || [];
    c.innerHTML = opts.map((o,i)=>`
      <button class="opt-btn w-full p-4 rounded-2xl border border-slate-200 bg-white font-black text-left hover:bg-brand-50 hover:border-brand-500"
        onclick="window.VQ.toggleLiveMulti(${i}, this)">
        ${escapeHtml(o)}
      </button>
    `).join("");
    $("client-confirm").classList.remove("hidden");
  } else if (q.type === "numeric_slider" || q.type === "timeline_slider") {
    const mid = Math.round(((q.min||0)+(q.max||100))/2);
    c.innerHTML = `
      <div class="bg-white p-6 rounded-2xl border border-slate-200">
        <input id="live-range" type="range" min="${q.min||0}" max="${q.max||100}" step="${q.step||1}"
          class="w-full" oninput="document.getElementById('live-range-val').textContent=this.value">
        <div class="text-center text-6xl font-black text-brand-700 mt-4" id="live-range-val">${mid}</div>
      </div>
    `;
    $("client-confirm").classList.remove("hidden");
  } else {
    c.innerHTML = `<p class="text-center text-slate-500 font-bold mt-8">Отговори на екрана на учителя.</p>`;
  }
};

const pickLive = (val, el) => {
  [...document.querySelectorAll("#client-opts .opt-btn")].forEach(b => b.classList.remove("border-brand-600","bg-brand-50"));
  el.classList.add("border-brand-600","bg-brand-50");
  live.selected = val;
  $("client-confirm").classList.remove("hidden");
};

const toggleLiveMulti = (idx, el) => {
  if (live.selectedMulti.has(idx)) {
    live.selectedMulti.delete(idx);
    el.classList.remove("border-brand-600","bg-brand-50");
  } else {
    live.selectedMulti.add(idx);
    el.classList.add("border-brand-600","bg-brand-50");
  }
};

const confirmLive = async () => {
  if (live.lastAnsweredQ === live.activeQ) return;

  const q = live.currentQ;
  let correct = false;

  if (q.type === "single" || q.type === "boolean") {
    correct = (live.selected === q.correct);
  } else if (q.type === "multiple") {
    const chosen = [...live.selectedMulti].sort((a,b)=>a-b);
    const corr = (q.correctMulti||[]).slice().sort((a,b)=>a-b);
    correct = JSON.stringify(chosen) === JSON.stringify(corr);
  } else if (q.type === "numeric_slider" || q.type === "timeline_slider") {
    const val = Number($("live-range").value);
    const tol = Number(q.tolerance||0);
    correct = Math.abs(val - Number(q.correct||0)) <= tol;
  } else {
    correct = false;
  }

  if (correct) live.myScore += Number(q.points||1);
  live.lastAnsweredQ = live.activeQ;

  // update participant doc (score + answered marker)
  const up = {
    score: live.myScore,
    [`answers.${String(live.activeQ)}`]: correct
  };
  await updateDoc(participantRef(live.pin, auth.currentUser.uid), up);

  // feedback
  $("client-emoji").textContent = correct ? "🎉" : "😓";
  $("client-title").textContent = correct ? "ВЯРНО!" : "ГРЕШНО…";
  showClientWait();
  setTimeout(() => { $("client-emoji").textContent="👀"; $("client-title").textContent="Гледай екрана!"; }, 2000);
};

/* ------------------ SOLO ------------------ */
const startSolo = async () => {
  const code = $("solo-code").value.trim();
  const dec = decodeLessonCode(code);
  if (!dec?.videoId || !Array.isArray(dec.questions)) return toast("Невалиден код", "error");

  solo.quiz = dec;
  solo.score = 0;
  solo.finished = false;
  solo.qIndex = -1;
  solo.selected = null;
  solo.selectedMulti = new Set();
  solo.orderPick = [];

  solo.sop = $("solo-sop").checked;
  solo.discussion = $("solo-discussion").checked;
  solo.studentName = $("solo-name").value.trim() || "Анонимен";

  if (!auth.currentUser) await signInAnonymously(auth);

  switchScreen("solo");
  mountSoloPlayer();
};

const mountSoloPlayer = () => {
  if (!YTReady) { toast("YouTube API още зарежда…", "error"); return; }
  $("solo-video-wrap").innerHTML = `<div id="solo-player" class="absolute inset-0"></div>`;
  solo.player = new YT.Player("solo-player", {
    videoId: solo.quiz.videoId,
    playerVars: { autoplay: 1, controls: 1 },
    events: {
      onStateChange: (e) => {
        if (e.data === 1) startSoloTick();
        if (e.data === 0) finishSolo();
      }
    }
  });
};

let soloTickInt = null;
const startSoloTick = () => {
  clearInterval(soloTickInt);
  soloTickInt = setInterval(() => {
    if (!solo.player || !solo.quiz || solo.finished) return;
    const t = Math.floor(solo.player.getCurrentTime() || 0);
    const next = solo.quiz.questions.findIndex((q,i)=> i>solo.qIndex && t >= (q.time||0));
    if (next !== -1) {
      solo.qIndex = next;
      triggerSoloQ(solo.quiz.questions[next]);
    }
  }, 300);
};

const triggerSoloQ = (q) => {
  solo.selected = null;
  solo.selectedMulti = new Set();
  solo.orderPick = [];

  try { solo.player.pauseVideo(); } catch {}
  $("solo-q-text").textContent = q.text || "";

  $("solo-q-text").classList.toggle("sop-text", !!solo.sop);
  $("solo-speak").classList.toggle("hidden", !solo.sop);

  renderSoloQ(q);
  $("solo-confirm").classList.add("hidden");
  $("solo-overlay").classList.remove("hidden");
  $("solo-overlay").classList.add("flex");

  if (solo.sop) speakText(q.text || "");
};

const renderSoloQ = (q) => {
  const c = $("solo-opts");
  c.innerHTML = "";

  const btnClass = solo.sop
    ? "sop-btn w-full text-left p-5 rounded-2xl bg-white/10 border border-white/20 text-white font-black hover:bg-white/20"
    : "w-full text-left p-5 rounded-2xl bg-white/10 border border-white/20 text-white font-black hover:bg-white/20";

  if (q.type === "single" || q.type === "boolean") {
    const opts = q.type==="boolean" ? ["ДА","НЕ"] : (q.options||[]);
    c.innerHTML = opts.map((o,i)=>`
      <button class="${btnClass}" onclick="window.VQ.pickSolo(${q.type==='boolean' ? (i===0) : i}, this)">${escapeHtml(o)}</button>
    `).join("");
  }

  if (q.type === "multiple") {
    const opts = q.options||[];
    c.innerHTML = opts.map((o,i)=>`
      <button class="${btnClass}" onclick="window.VQ.toggleSoloMulti(${i}, this)">${escapeHtml(o)}</button>
    `).join("");
    $("solo-confirm").classList.remove("hidden");
  }

  if (q.type === "ordering") {
    const opts = q.options||[];
    c.innerHTML = `
      <div class="text-white font-black mb-2">Натискай отговорите в правилния ред:</div>
      ${opts.map((o,i)=>`<button class="${btnClass}" onclick="window.VQ.pickOrder(${i}, this)">${escapeHtml(o)}</button>`).join("")}
      <div class="mt-3 text-white font-bold text-sm">Избрани: <span id="order-picked"></span></div>
    `;
    $("solo-confirm").classList.remove("hidden");
    updateOrderPicked();
  }

  if (q.type === "numeric_slider" || q.type === "timeline_slider") {
    const mid = Math.round(((q.min||0)+(q.max||100))/2);
    c.innerHTML = `
      <div class="w-full bg-white/10 p-6 rounded-2xl border border-white/20">
        <input id="solo-range" type="range" min="${q.min||0}" max="${q.max||100}" step="${q.step||1}"
          class="w-full" oninput="document.getElementById('solo-range-val').textContent=this.value">
        <div id="solo-range-val" class="text-white text-5xl font-black mt-4">${mid}</div>
      </div>
    `;
    $("solo-confirm").classList.remove("hidden");
  }
};

const pickSolo = (val, el) => {
  [...document.querySelectorAll("#solo-opts button")].forEach(b => b.classList.remove("ring-4","ring-brand-500"));
  el.classList.add("ring-4","ring-brand-500");
  solo.selected = val;
  $("solo-confirm").classList.remove("hidden");
};

const toggleSoloMulti = (idx, el) => {
  if (solo.selectedMulti.has(idx)) {
    solo.selectedMulti.delete(idx);
    el.classList.remove("ring-4","ring-brand-500");
  } else {
    solo.selectedMulti.add(idx);
    el.classList.add("ring-4","ring-brand-500");
  }
};

const pickOrder = (idx) => {
  if (solo.orderPick.includes(idx)) return;
  solo.orderPick.push(idx);
  updateOrderPicked();
};

const updateOrderPicked = () => {
  const q = solo.quiz.questions[solo.qIndex];
  const span = document.getElementById("order-picked");
  if (!span) return;
  const labels = (q.options||[]).filter((_,i)=>solo.orderPick.includes(i));
  span.textContent = labels.join(" → ");
};

const confirmSolo = async () => {
  const q = solo.quiz.questions[solo.qIndex];
  let correct = false;

  if (q.type === "single" || q.type === "boolean") {
    correct = (solo.selected === q.correct);
  } else if (q.type === "multiple") {
    const chosen = [...solo.selectedMulti].sort((a,b)=>a-b);
    const corr = (q.correctMulti||[]).slice().sort((a,b)=>a-b);
    correct = JSON.stringify(chosen) === JSON.stringify(corr);
  } else if (q.type === "ordering") {
    const picked = solo.orderPick.map(i => (q.options||[])[i]);
    correct = JSON.stringify(picked) === JSON.stringify(q.correctOrder || (q.options||[]));
  } else if (q.type === "numeric_slider" || q.type === "timeline_slider") {
    const val = Number(document.getElementById("solo-range").value);
    correct = Math.abs(val - Number(q.correct||0)) <= Number(q.tolerance||0);
  }

  if (correct) { solo.score += Number(q.points||1); toast("ВЯРНО! 🎉", "success"); }
  else toast("ГРЕШНО…", "error");

  // hide overlay and continue
  $("solo-overlay").classList.add("hidden");
  $("solo-overlay").classList.remove("flex");
  try { window.speechSynthesis?.cancel?.(); } catch {}

  setTimeout(() => { try { solo.player.playVideo(); } catch {} }, 900);

  // if last question and video ends soon -> finish on end or manual
};

const finishSolo = async () => {
  if (solo.finished) return;
  solo.finished = true;

  const total = maxPoints(solo.quiz.questions);
  $("finish-score").textContent = `${solo.score} / ${total}`;
  switchScreen("finish");

  if (solo.discussion) return; // no save
  if (!solo.quiz.ownerId) return;

  try {
    await setDoc(doc(soloResultsCol(solo.quiz.ownerId), `${auth.currentUser.uid}_${Date.now()}`), {
      studentName: solo.studentName,
      quizTitle: solo.quiz.title + (solo.sop ? " (СОП)" : ""),
      score: `${solo.score}/${total}`,
      timestamp: serverTimestamp(),
      userId: auth.currentUser.uid
    });
  } catch {}
};

const speakText = (txt) => {
  try{
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(txt);
    u.lang = "bg-BG";
    u.rate = 0.9;
    window.speechSynthesis.speak(u);
  }catch{}
};

const speakSolo = () => {
  const q = solo.quiz?.questions?.[solo.qIndex];
  if (!q) return;
  speakText(q.text||"");
};

/* ------------------ URL pin auto-fill ------------------ */
const applyPinFromUrl = () => {
  const p = new URLSearchParams(location.search).get("pin");
  if (p) {
    $("live-pin").value = p;
    toast("ПИН зареден от QR.", "success");
  }
};

/* ------------------ Public API to window ------------------ */
window.VQ = {
  // screens/auth
  authSubmit, logout,
  gotoTeacher: () => switchScreen("teacher"),

  // teacher
  newLesson, editLesson, deleteLesson, saveLesson,
  openImport, submitImport,
  share, copyShare,

  // editor
  loadEditorVideo,
  openQuestionModal,
  renderModalFields,
  addOptRow,
  saveQuestion,
  editQ: editQuestionAt,
  delQ,
  jumpTo,
  bumpTime,

  // history
  switchHist,
  deleteSolo, deleteClass,
  exportSoloExcel,
  viewClass,
  exportClassExcel,
  exportClassPDF,

  // live
  hostStart,
  startHostPlayback,
  resumeHost,
  finishHost,
  joinLive,
  pickLive, toggleLiveMulti, confirmLive,

  // solo
  startSolo,
  pickSolo, toggleSoloMulti, pickOrder,
  confirmSolo,
  speakSolo,

  // modals
  closeModal
};

/* ------------------ Auth state ------------------ */
onAuthStateChanged(auth, async (u) => {
  user = u;

  // always icons
  safeIcons();
  applyPinFromUrl();

  if (u && u.email) {
    // teacher candidate
    try {
      await ensureTeacherProfile(u);
      loadTeacherData();
      switchScreen("teacher");
    } catch {
      // if profile fails, still allow welcome
      switchScreen("welcome");
    }
  } else {
    switchScreen("welcome");
  }

  // hide loader
  $("auth-loader")?.classList.add("hidden");
});

/* ------------------ Initial ------------------ */
setAuthMode("login");
safeIcons();
applyPinFromUrl();
