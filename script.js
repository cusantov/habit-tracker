'use strict';

/* ===== Константы ===== */
const STORAGE_KEY = 'habitflow_data';
const LAST_VISIT_KEY = 'habitflow_lastVisit';
const THEME_KEY = 'habitflow_theme';
const REMINDER_KEY = 'habitflow_reminder';
const MAX_TITLE_LENGTH = 50;
const WEEK_LENGTH = 7;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/* ===== Элементы страницы ===== */
const form = document.getElementById('habit-form');
const input = document.getElementById('habit-input');
const errorEl = document.getElementById('form-error');
const counterEl = document.getElementById('char-counter');
const listEl = document.getElementById('habit-list');
const emptyEl = document.getElementById('empty-state');
const statsEl = document.getElementById('stats');
const progressEl = document.getElementById('progress-fill');
const todayEl = document.getElementById('today');
const noticeEl = document.getElementById('notice');
const template = document.getElementById('habit-template');
const themeToggle = document.getElementById('theme-toggle');
const exportBtn = document.getElementById('export-btn');
const importBtn = document.getElementById('import-btn');
const importInput = document.getElementById('import-input');
const reminderTime = document.getElementById('reminder-time');
const timePicker = document.getElementById('time-picker');
const wheelHours = document.getElementById('wheel-hours');
const wheelMinutes = document.getElementById('wheel-minutes');
const timeDone = document.getElementById('time-done');
const dayStatus = document.getElementById('day-status');
const toast = document.getElementById('toast');
const toastText = document.getElementById('toast-text');
const toastUndo = document.getElementById('toast-undo');
const reminderToggle = document.getElementById('reminder-toggle');
const reminderHint = document.getElementById('reminder-hint');

/* ===== Состояние ===== */
let habits = loadHabits();
let today = toDateKey(new Date());
let reminder = loadReminder();
let newHabitId = null; // карточка, которой нужна анимация появления
let noticeTimer = null;
let drag = null; // { card, pointerId } во время перетаскивания
let justCompletedId = null; // карточка, у которой нужно прорисовать галочку
let undoState = null; // { habit, index } — последняя удалённая привычка
let toastTimer = null;

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

/* ===== Даты ===== */

// Дата в формате YYYY-MM-DD по локальному времени
// (toISOString не подходит: он даёт дату по UTC и ошибается около полуночи)
function toDateKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// Последние 7 дней, от самого раннего до сегодняшнего
function getLastWeek() {
  const days = [];
  for (let i = WEEK_LENGTH - 1; i >= 0; i--) {
    const date = new Date();
    date.setDate(date.getDate() - i);
    days.push(date);
  }
  return days;
}

function formatLongDate(date) {
  const text = date.toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' });
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/* ===== Хранилище ===== */

// Приводит произвольный массив к формату ТЗ и отбрасывает повреждённые записи.
// Используется и при загрузке из localStorage, и при импорте файла.
function sanitizeHabits(list) {
  if (!Array.isArray(list)) return [];

  return list
    .filter((h) => h && typeof h.title === 'string' && Array.isArray(h.completedDates))
    .map((h) => ({
      id: Number(h.id) || Date.now(),
      title: normalizeTitle(h.title),
      completedDates: [...new Set(h.completedDates.filter((d) => DATE_PATTERN.test(d)))].sort(),
    }))
    .filter((h) => h.title !== '' && h.title.length <= MAX_TITLE_LENGTH);
}

function loadHabits() {
  try {
    return sanitizeHabits(JSON.parse(localStorage.getItem(STORAGE_KEY)));
  } catch {
    return [];
  }
}

function saveHabits() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(habits));
}

function uniqueId() {
  let id = Date.now();
  while (habits.some((h) => h.id === id)) id++;
  return id;
}

/* ===== Сброс отметок при смене даты ===== */

// Отметка «выполнено сегодня» — это наличие сегодняшней даты в completedDates.
// Поэтому при наступлении нового дня все отметки снимаются сами,
// а прошлые даты остаются в истории (из неё строится ряд за неделю).
function checkNewDay() {
  const lastVisit = localStorage.getItem(LAST_VISIT_KEY);

  if (lastVisit && lastVisit !== today) {
    const hadMarks = habits.some((h) => h.completedDates.includes(lastVisit));
    if (hadMarks) {
      showNotice('Новый день — отметки сброшены. История за прошлые дни сохранена.');
    }
  }

  localStorage.setItem(LAST_VISIT_KEY, today);
}

// Раз в 30 секунд: смена даты, если вкладка открыта через полночь, и напоминание
function tick() {
  const now = toDateKey(new Date());
  if (now !== today) {
    today = now;
    checkNewDay();
    render();
  }
  checkReminder();
}

function showNotice(text, isError = false) {
  noticeEl.textContent = text;
  noticeEl.classList.toggle('is-error', isError);
  noticeEl.hidden = false;
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => {
    noticeEl.hidden = true;
  }, 6000);
}

/* ===== Операции с привычками ===== */

// Убираем лишние пробелы: «  Утренняя   зарядка » → «Утренняя зарядка»
function normalizeTitle(raw) {
  return raw.trim().replace(/\s+/g, ' ');
}

function findByTitle(title) {
  const lower = title.toLowerCase();
  return habits.find((h) => h.title.toLowerCase() === lower);
}

// Возвращает текст ошибки или пустую строку, если название подходит
function validateTitle(title) {
  if (title === '') {
    return 'Введите название привычки.';
  }
  if (title.length > MAX_TITLE_LENGTH) {
    return `Слишком длинное название: ${title.length} из ${MAX_TITLE_LENGTH} символов.`;
  }
  if (findByTitle(title)) {
    return `Привычка «${title}» уже есть в списке.`;
  }
  return '';
}

function addHabit(title) {
  const id = uniqueId();
  habits.push({ id, title, completedDates: [] });
  newHabitId = id;
  saveHabits();
  render();
}

function toggleHabit(id) {
  const habit = habits.find((h) => h.id === id);
  if (!habit) return;

  if (habit.completedDates.includes(today)) {
    habit.completedDates = habit.completedDates.filter((d) => d !== today);
  } else {
    habit.completedDates.push(today);
    habit.completedDates.sort();
    justCompletedId = id;
  }
  saveHabits();
  render();
}

// withRender = false — когда карточку сначала нужно красиво убрать анимацией
function deleteHabit(id, withRender = true) {
  const index = habits.findIndex((h) => h.id === id);
  if (index < 0) return;

  const [removed] = habits.splice(index, 1);
  saveHabits();
  if (withRender) render();
  showUndoToast(removed, index);
}

// Возвращает удалённую привычку на прежнее место
function undoDelete() {
  if (!undoState) return;
  const { habit, index } = undoState;
  hideToast();

  // Пока висела плашка, могли добавить привычку с тем же названием — тогда не дублируем
  if (findByTitle(habit.title)) return;

  const before = cardPositions();
  habits.splice(Math.min(index, habits.length), 0, habit);
  newHabitId = habit.id;
  saveHabits();
  render();
  slideCardsFrom(before);
}

/* ===== Серия дней подряд ===== */

// Сколько дней подряд привычка выполнялась. Если сегодня ещё не отмечена,
// серия не прерывается и считается со вчерашнего дня.
function getStreak(habit) {
  const done = new Set(habit.completedDates);
  const date = new Date();
  if (!done.has(toDateKey(date))) date.setDate(date.getDate() - 1);

  let streak = 0;
  while (done.has(toDateKey(date))) {
    streak++;
    date.setDate(date.getDate() - 1);
  }
  return streak;
}

// 1 день, 2 дня, 5 дней, 21 день
function pluralDays(n) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return 'день';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'дня';
  return 'дней';
}

/* ===== Плашка «Отменить» ===== */

function showUndoToast(habit, index) {
  undoState = { habit, index };
  toastText.textContent = `Удалено: «${habit.title}»`;
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, 4000);
}

function hideToast() {
  clearTimeout(toastTimer);
  undoState = null;
  toast.hidden = true;
}

toastUndo.addEventListener('click', undoDelete);

function moveHabit(id, offset) {
  const from = habits.findIndex((h) => h.id === id);
  const to = from + offset;
  if (from < 0 || to < 0 || to >= habits.length) return;

  const [habit] = habits.splice(from, 1);
  habits.splice(to, 0, habit);
  saveHabits();
  render();
}

function isDoneToday(habit) {
  return habit.completedDates.includes(today);
}

/* ===== Отрисовка ===== */

function createHabitCard(habit, week) {
  const card = template.content.firstElementChild.cloneNode(true);
  const done = isDoneToday(habit);

  card.dataset.id = habit.id;
  card.classList.toggle('is-done', done);
  if (habit.id === newHabitId) card.classList.add('is-new');
  if (habit.id === justCompletedId) card.classList.add('is-just-done');

  const streak = getStreak(habit);
  if (streak >= 2) {
    const badge = card.querySelector('.habit__streak');
    badge.hidden = false;
    badge.querySelector('.habit__streak-count').textContent = streak;
    badge.title = `${streak} ${pluralDays(streak)} подряд`;
    badge.setAttribute('aria-label', `Серия: ${streak} ${pluralDays(streak)} подряд`);
  }

  // Весь пользовательский текст вставляется через textContent / атрибуты — защита от XSS
  card.querySelector('.habit__title').textContent = habit.title;

  const checkbox = card.querySelector('.habit__checkbox');
  checkbox.checked = done;
  checkbox.setAttribute('aria-label', `Выполнено сегодня: ${habit.title}`);

  card.querySelector('.habit__delete').setAttribute('aria-label', `Удалить привычку «${habit.title}»`);
  card.querySelector('.habit__handle').setAttribute(
    'aria-label',
    `Переместить «${habit.title}». Перетащите или используйте стрелки вверх и вниз`
  );

  const weekEl = card.querySelector('.habit__week');
  weekEl.setAttribute('aria-label', 'Последние 7 дней');
  week.forEach((date) => {
    const key = toDateKey(date);
    const filled = habit.completedDates.includes(key);
    const day = document.createElement('li');
    day.className = 'day';
    day.classList.toggle('is-filled', filled);
    day.classList.toggle('is-today', key === today);
    // Подпись под квадратом: ПН, ВТ, СР, ЧТ, ПТ, СБ, ВС
    day.dataset.label = date.toLocaleDateString('ru-RU', { weekday: 'short' }).replace('.', '').toUpperCase();
    day.title = `${date.toLocaleDateString('ru-RU', { weekday: 'short', day: 'numeric', month: 'short' })} — ${filled ? 'выполнено' : 'не выполнено'}`;
    weekEl.append(day);
  });

  return card;
}

function render() {
  todayEl.textContent = formatLongDate(new Date());

  const week = getLastWeek();
  listEl.replaceChildren(...habits.map((h) => createHabitCard(h, week)));
  newHabitId = null;
  justCompletedId = null;

  emptyEl.hidden = habits.length > 0;
  listEl.hidden = habits.length === 0;

  const doneCount = habits.filter(isDoneToday).length;
  statsEl.textContent = `Выполнено: ${doneCount} из ${habits.length}`;
  progressEl.style.width = habits.length ? `${(doneCount / habits.length) * 100}%` : '0';

  dayStatus.hidden = !(habits.length > 0 && doneCount === habits.length);
}

/* ===== Форма ===== */

function showError(message) {
  errorEl.textContent = message;
  input.classList.toggle('is-invalid', message !== '');
}

function updateCounter() {
  const length = normalizeTitle(input.value).length;
  counterEl.textContent = `${length}/${MAX_TITLE_LENGTH}`;
  counterEl.classList.toggle('is-over', length > MAX_TITLE_LENGTH);
}

form.addEventListener('submit', (event) => {
  event.preventDefault();

  const title = normalizeTitle(input.value);
  const error = validateTitle(title);
  if (error) {
    showError(error);
    input.focus();
    return;
  }

  addHabit(title);
  input.value = '';
  updateCounter();
  showError('');
  input.focus();
});

input.addEventListener('input', () => {
  updateCounter();
  if (errorEl.textContent) showError('');
});

/* ===== Действия в списке (делегирование событий) ===== */

listEl.addEventListener('change', (event) => {
  if (!event.target.classList.contains('habit__checkbox')) return;
  const card = event.target.closest('.habit');
  toggleHabit(Number(card.dataset.id));
});

listEl.addEventListener('click', (event) => {
  const button = event.target.closest('.habit__delete');
  if (!button) return;
  removeCardAnimated(button.closest('.habit'));
});

// Данные и localStorage обновляются сразу, а карточка тает,
// и остальные плавно съезжают на её место
function removeCardAnimated(card) {
  if (card.classList.contains('is-removing')) return;
  card.classList.add('is-removing');
  deleteHabit(Number(card.dataset.id), false);

  const finish = () => {
    const before = cardPositions();
    render();
    slideCardsFrom(before);
  };

  if (reducedMotion.matches) {
    finish();
    return;
  }

  const fadeOut = card.animate(
    [{ opacity: 1, transform: 'scale(1)' }, { opacity: 0, transform: 'scale(0.96)' }],
    { duration: 180, easing: 'ease-in', fill: 'forwards' }
  );
  // Страховка: в фоновой вкладке браузер притормаживает анимации
  const timeout = new Promise((resolve) => setTimeout(resolve, 250));
  Promise.race([fadeOut.finished, timeout]).then(finish, finish);
}

/* ===== Drag-and-drop ===== */
// Pointer Events вместо HTML5 drag&drop: так перетаскивание работает и мышью, и пальцем.
// Анимация в стиле iOS: поднятая карточка едет за пальцем, соседние плавно
// разъезжаются (техника FLIP), а при отпускании карточка пружинисто встаёт на место.

const SPRING = 'cubic-bezier(0.2, 0.9, 0.3, 1.12)'; // лёгкий «перелёт» в конце, как на iOS
const LIFT_SCALE = 1.03;

// Плавно переносит элемент из старой визуальной позиции в текущую
function slideFrom(element, deltaY, duration = 320) {
  if (!deltaY || reducedMotion.matches) return;
  element.animate(
    [{ transform: `translateY(${deltaY}px)` }, { transform: 'none' }],
    { duration, easing: SPRING }
  );
}

// FLIP: запоминаем, где карточки видны сейчас (с учётом идущих анимаций),
// меняем DOM, затем анимируем каждую от старого места к новому
function reorderAnimated(cards, mutate) {
  const before = new Map(cards.map((card) => [card, card.getBoundingClientRect().top]));
  mutate();
  cards.forEach((card) => {
    card.getAnimations().forEach((animation) => animation.cancel());
    slideFrom(card, before.get(card) - card.getBoundingClientRect().top);
  });
}

// render() пересоздаёт карточки, поэтому позиции запоминаем по id
function cardPositions() {
  return new Map([...listEl.children].map((card) => [card.dataset.id, card.getBoundingClientRect().top]));
}

function slideCardsFrom(before) {
  [...listEl.children].forEach((card) => {
    if (before.has(card.dataset.id)) {
      slideFrom(card, before.get(card.dataset.id) - card.getBoundingClientRect().top);
    }
  });
}

// Двигает поднятую карточку так, чтобы она оставалась под указателем
function followPointer(pageY) {
  const offset = drag.startTop + (pageY - drag.startPageY) - drag.card.offsetTop;
  drag.offset = offset;
  drag.card.style.transform = `translateY(${offset}px) scale(${LIFT_SCALE})`;
}

listEl.addEventListener('pointerdown', (event) => {
  const handle = event.target.closest('.habit__handle');
  if (!handle || event.button !== 0) return;

  event.preventDefault();
  const card = handle.closest('.habit');
  card.getAnimations().forEach((animation) => animation.cancel());

  drag = {
    card,
    pointerId: event.pointerId,
    startPageY: event.pageY,
    startTop: card.offsetTop,
    offset: 0,
  };
  card.classList.add('is-dragging');
  listEl.classList.add('is-sorting');
  followPointer(event.pageY);
});

// Движение и отпускание слушаем на document: при перестановке карточка выходит из DOM,
// и захват указателя на ручке потерялся бы, а курсор может уйти за пределы списка
document.addEventListener('pointermove', (event) => {
  if (!drag || event.pointerId !== drag.pointerId) return;

  // Середина поднятой карточки там, куда её дотянули
  const center = drag.startTop + (event.pageY - drag.startPageY) + drag.card.offsetHeight / 2;

  // Сравниваем с серединами соседей по offsetTop — это место в раскладке,
  // на него не влияют анимации, поэтому карточки не дёргаются туда-обратно
  const siblings = [...listEl.children].filter((card) => card !== drag.card);
  const before = siblings.find((card) => center < card.offsetTop + card.offsetHeight / 2) || null;

  if (drag.card.nextElementSibling !== before) {
    reorderAnimated(siblings, () => listEl.insertBefore(drag.card, before));
  }

  followPointer(event.pageY);
});

function finishDrag(event) {
  if (!drag || event.pointerId !== drag.pointerId) return;

  const { card, offset } = drag;
  drag = null;
  listEl.classList.remove('is-sorting');
  card.classList.remove('is-dragging');
  card.style.transform = '';

  // Карточка «опускается» из-под пальца в свой слот
  if (!reducedMotion.matches) {
    card.animate(
      [{ transform: `translateY(${offset}px) scale(${LIFT_SCALE})` }, { transform: 'none' }],
      { duration: 280, easing: SPRING }
    );
  }

  // Порядок карточек в DOM становится новым порядком массива
  const order = [...listEl.children].map((item) => Number(item.dataset.id));
  habits.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
  saveHabits();
}

document.addEventListener('pointerup', finishDrag);
document.addEventListener('pointercancel', finishDrag);

// Сортировка с клавиатуры: фокус на ручке + стрелки
listEl.addEventListener('keydown', (event) => {
  const handle = event.target.closest('.habit__handle');
  if (!handle || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return;

  event.preventDefault();
  const id = Number(handle.closest('.habit').dataset.id);

  const before = cardPositions();
  moveHabit(id, event.key === 'ArrowUp' ? -1 : 1);
  slideCardsFrom(before);

  listEl.querySelector(`[data-id="${id}"] .habit__handle`).focus();
});

/* ===== Тема ===== */

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  themeToggle.setAttribute('aria-label', theme === 'dark' ? 'Включить светлую тему' : 'Включить тёмную тему');
}

function initTheme() {
  // По умолчанию светлая тема из ТЗ, тёмная — только если пользователь выбрал её сам
  applyTheme(localStorage.getItem(THEME_KEY) === 'dark' ? 'dark' : 'light');
}

// Новая тема «растекается» кругом от кнопки по всей странице (View Transitions API).
// Где API нет (старые Firefox/Safari), цвета просто плавно меняются через CSS transition.
themeToggle.addEventListener('click', () => {
  const root = document.documentElement;
  const next = root.dataset.theme === 'dark' ? 'light' : 'dark';
  localStorage.setItem(THEME_KEY, next);

  if (!document.startViewTransition || reducedMotion.matches) {
    applyTheme(next);
    return;
  }

  const button = themeToggle.getBoundingClientRect();
  const x = button.left + button.width / 2;
  const y = button.top + button.height / 2;
  // Радиус до самого дальнего угла экрана, чтобы круг накрыл всё
  const radius = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));

  const transition = document.startViewTransition(() => {
    // Без обычных CSS-переходов: иначе в «снимке» новой темы цвета ещё догоняли бы
    root.classList.add('is-theme-switching');
    applyTheme(next);
  });

  transition.ready
    .then(() => {
      root.animate(
        { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] },
        { duration: 700, easing: 'cubic-bezier(0.65, 0, 0.35, 1)', pseudoElement: '::view-transition-new(root)' }
      );
    })
    // Быстрый повторный клик прерывает прошлый переход — тема всё равно применена,
    // просто без анимации; глушим отказ, чтобы в консоли не было красной ошибки
    .catch(() => {});

  transition.finished
    .catch(() => {})
    .finally(() => root.classList.remove('is-theme-switching'));
});

/* ===== Экспорт / импорт ===== */

function exportHabits() {
  const blob = new Blob([JSON.stringify(habits, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `привычки-${today}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Импорт объединяет данные, а не затирает их: у совпадающих привычек
// складывается история, новые добавляются в конец списка
async function importHabits(file) {
  let imported;
  try {
    imported = sanitizeHabits(JSON.parse(await file.text()));
  } catch {
    showNotice('Не удалось прочитать файл: это не JSON.', true);
    return;
  }

  if (imported.length === 0) {
    showNotice('В файле нет привычек в подходящем формате.', true);
    return;
  }

  let added = 0;
  let updated = 0;
  imported.forEach((item) => {
    const existing = findByTitle(item.title);
    if (existing) {
      existing.completedDates = [...new Set([...existing.completedDates, ...item.completedDates])].sort();
      updated++;
    } else {
      const id = habits.some((h) => h.id === item.id) ? uniqueId() : item.id;
      habits.push({ ...item, id });
      added++;
    }
  });

  saveHabits();
  render();
  showNotice(`Импорт завершён: добавлено ${added}, обновлено ${updated}.`);
}

exportBtn.addEventListener('click', exportHabits);
importBtn.addEventListener('click', () => importInput.click());
importInput.addEventListener('change', () => {
  const [file] = importInput.files;
  if (file) importHabits(file);
  importInput.value = ''; // чтобы повторный выбор того же файла снова сработал
});

/* ===== Напоминания (Notification API) ===== */

function loadReminder() {
  try {
    const saved = JSON.parse(localStorage.getItem(REMINDER_KEY));
    if (saved && typeof saved.time === 'string') {
      return { enabled: Boolean(saved.enabled), time: saved.time, lastFired: saved.lastFired || '' };
    }
  } catch {
    // повреждённая запись — используем значения по умолчанию
  }
  return { enabled: false, time: '21:00', lastFired: '' };
}

function saveReminder() {
  localStorage.setItem(REMINDER_KEY, JSON.stringify(reminder));
}

function setReminderHint(text, isError = false) {
  reminderHint.textContent = text;
  reminderHint.classList.toggle('is-error', isError);
}

function renderReminder() {
  reminderTime.textContent = reminder.time;
  reminderToggle.setAttribute('aria-checked', String(reminder.enabled));
  if (reminder.enabled) {
    setReminderHint(`Напомню в ${reminder.time}, если вкладка будет открыта.`);
  } else {
    setReminderHint('');
  }
}

// Причина, по которой уведомления недоступны, или пустая строка
function notificationProblem() {
  if (!('Notification' in window)) return 'Браузер не поддерживает уведомления.';
  if (!window.isSecureContext) return 'Уведомления работают только по https:// или на localhost.';
  if (Notification.permission === 'denied') return 'Уведомления запрещены — разрешите их в настройках сайта.';
  return '';
}

async function enableReminder() {
  const problem = notificationProblem();
  if (problem) {
    setReminderHint(problem, true);
    return;
  }

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    setReminderHint('Без разрешения на уведомления напоминание не сработает.', true);
    return;
  }

  reminder.enabled = true;
  saveReminder();
  renderReminder();
}

function checkReminder() {
  if (!reminder.enabled || reminder.lastFired === today) return;
  if (!('Notification' in window) || Notification.permission !== 'granted') return;

  const now = new Date();
  const current = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  if (current < reminder.time) return;

  reminder.lastFired = today;
  saveReminder();

  const left = habits.filter((h) => !isDoneToday(h)).length;
  if (left === 0) return;

  try {
    new Notification('Трекер привычек', {
      body: `Осталось выполнить сегодня: ${left} из ${habits.length}`,
      tag: 'habitflow-reminder',
    });
  } catch {
    // Мобильный Chrome требует Service Worker для уведомлений — там просто молчим
  }
}

reminderToggle.addEventListener('click', () => {
  if (reminder.enabled) {
    reminder.enabled = false;
    saveReminder();
    renderReminder();
  } else {
    enableReminder();
  }
});

/* ===== Колесо выбора времени (в стиле iOS) ===== */

const WHEEL_ITEM_HEIGHT = 34; // совпадает с высотой .wheel__item в style.css
const pad2 = (n) => String(n).padStart(2, '0');

function buildWheel(wheel, count) {
  for (let i = 0; i < count; i++) {
    const item = document.createElement('div');
    item.className = 'wheel__item';
    item.textContent = pad2(i);
    item.dataset.value = i;
    wheel.append(item);
  }
}

// Индекс строки, которая сейчас стоит по центру колеса
function wheelValue(wheel) {
  const index = Math.round(wheel.scrollTop / WHEEL_ITEM_HEIGHT);
  return Math.min(Math.max(index, 0), wheel.children.length - 1);
}

function scrollWheelTo(wheel, value, smooth) {
  wheel.scrollTo({ top: value * WHEEL_ITEM_HEIGHT, behavior: smooth ? 'smooth' : 'auto' });
}

function highlightWheel(wheel) {
  const value = wheelValue(wheel);
  [...wheel.children].forEach((item, i) => item.classList.toggle('is-selected', i === value));
}

// Сохраняем время, когда колесо остановилось
function commitTime() {
  const time = `${pad2(wheelValue(wheelHours))}:${pad2(wheelValue(wheelMinutes))}`;
  if (time === reminder.time) return;

  reminder.time = time;
  reminder.lastFired = ''; // новое время — сегодня можно напомнить ещё раз
  saveReminder();
  renderReminder();
}

function openTimePicker() {
  timePicker.hidden = false;
  reminderTime.setAttribute('aria-expanded', 'true');

  const [hours, minutes] = reminder.time.split(':').map(Number);
  scrollWheelTo(wheelHours, hours, false);
  scrollWheelTo(wheelMinutes, minutes, false);
  highlightWheel(wheelHours);
  highlightWheel(wheelMinutes);
  wheelHours.focus({ preventScroll: true });
}

function closeTimePicker(returnFocus = true) {
  if (timePicker.hidden) return;
  commitTime();
  timePicker.hidden = true;
  reminderTime.setAttribute('aria-expanded', 'false');
  if (returnFocus) reminderTime.focus();
}

[wheelHours, wheelMinutes].forEach((wheel) => {
  let settleTimer = null;

  wheel.addEventListener('scroll', () => {
    highlightWheel(wheel);
    clearTimeout(settleTimer);
    settleTimer = setTimeout(commitTime, 150);
  });

  // Клик по цифре докручивает её в центр
  wheel.addEventListener('click', (event) => {
    const item = event.target.closest('.wheel__item');
    if (item) scrollWheelTo(wheel, Number(item.dataset.value), true);
  });

  wheel.addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
    event.preventDefault();
    scrollWheelTo(wheel, wheelValue(wheel) + (event.key === 'ArrowUp' ? -1 : 1), true);
  });
});

buildWheel(wheelHours, 24);
buildWheel(wheelMinutes, 60);

reminderTime.addEventListener('click', () => {
  if (timePicker.hidden) openTimePicker();
  else closeTimePicker();
});

timeDone.addEventListener('click', () => closeTimePicker());

// Закрываем по клику мимо окна и по Escape
document.addEventListener('pointerdown', (event) => {
  if (!timePicker.hidden && !event.target.closest('.time-field')) closeTimePicker(false);
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') closeTimePicker();
});

/* ===== Запуск ===== */
initTheme();
checkNewDay();
render();
renderReminder();
checkReminder();
setInterval(tick, 30 * 1000);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) tick();
});
