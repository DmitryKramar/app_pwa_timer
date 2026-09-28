(function () {
  'use strict';

  var STORAGE_SCENARIOS = 'timer.scenarios.v1';
  var STORAGE_SETTINGS = 'timer.settings.v1';
  var RING_LENGTH = 2 * Math.PI * 90;

  var els = {
    hours: document.getElementById('inHours'),
    minutes: document.getElementById('inMinutes'),
    seconds: document.getElementById('inSeconds'),
    digits: document.getElementById('digits'),
    status: document.getElementById('statusLabel'),
    ring: document.getElementById('ringProgress'),
    btnStart: document.getElementById('btnStart'),
    btnPause: document.getElementById('btnPause'),
    btnReset: document.getElementById('btnReset'),
    remindToggle: document.getElementById('remindToggle'),
    remindIntervalWrap: document.getElementById('remindIntervalWrap'),
    remindInterval: document.getElementById('remindInterval'),
    notifyBtn: document.getElementById('notifyBtn'),
    notifyHint: document.getElementById('notifyHint'),
    flash: document.getElementById('flash'),
    badge: document.getElementById('reminderBadge'),
    scenarioName: document.getElementById('scenarioName'),
    btnSave: document.getElementById('btnSave'),
    scenarioList: document.getElementById('scenarioList'),
    emptyHint: document.getElementById('emptyHint'),
    toast: document.getElementById('toast')
  };

  var state = {
    totalMs: 25 * 60 * 1000,
    remainingMs: 25 * 60 * 1000,
    running: false,
    endTime: 0,
    timerId: 0,
    lastReminderIndex: 0
  };

  var audioCtx = null;
  var toastTimer = 0;
  var flashTimer = 0;

  /* ------------------------------------------------------------------ */
  /* Utilities                                                           */
  /* ------------------------------------------------------------------ */

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function pad2(n) {
    return (n < 10 ? '0' : '') + n;
  }

  function formatTime(ms) {
    var totalSeconds = Math.max(0, Math.ceil(ms / 1000));
    var h = Math.floor(totalSeconds / 3600);
    var m = Math.floor((totalSeconds % 3600) / 60);
    var s = totalSeconds % 60;
    return pad2(h) + ':' + pad2(m) + ':' + pad2(s);
  }

  function humanDuration(ms) {
    var totalSeconds = Math.round(ms / 1000);
    var h = Math.floor(totalSeconds / 3600);
    var m = Math.floor((totalSeconds % 3600) / 60);
    var s = totalSeconds % 60;
    var parts = [];
    if (h) parts.push(h + ' ч');
    if (m) parts.push(m + ' мин');
    if (s || !parts.length) parts.push(s + ' с');
    return parts.join(' ');
  }

  function readInputsMs() {
    var h = clamp(parseInt(els.hours.value, 10) || 0, 0, 99);
    var m = clamp(parseInt(els.minutes.value, 10) || 0, 0, 59);
    var s = clamp(parseInt(els.seconds.value, 10) || 0, 0, 59);
    return ((h * 60 + m) * 60 + s) * 1000;
  }

  function setInputsFromMs(ms) {
    var totalSeconds = Math.round(ms / 1000);
    var h = Math.floor(totalSeconds / 3600);
    var m = Math.floor((totalSeconds % 3600) / 60);
    var s = totalSeconds % 60;
    els.hours.value = String(clamp(h, 0, 99));
    els.minutes.value = String(m);
    els.seconds.value = String(s);
  }

  function readIntervalMinutes() {
    return clamp(parseInt(els.remindInterval.value, 10) || 0, 1, 999);
  }

  function showToast(message) {
    els.toast.textContent = message;
    els.toast.hidden = false;
    window.clearTimeout(toastTimer);
    requestAnimationFrame(function () {
      els.toast.classList.add('show');
    });
    toastTimer = window.setTimeout(function () {
      els.toast.classList.remove('show');
      window.setTimeout(function () {
        els.toast.hidden = true;
      }, 220);
    }, 2600);
  }

  /* ------------------------------------------------------------------ */
  /* Sound, vibration, notifications                                     */
  /* ------------------------------------------------------------------ */

  function ensureAudio() {
    if (!audioCtx) {
      var Ctx = window.AudioContext || window.webkitAudioContext;
      if (Ctx) {
        try {
          audioCtx = new Ctx();
        } catch (err) {
          audioCtx = null;
        }
      }
    }
    if (audioCtx && audioCtx.state === 'suspended') {
      audioCtx.resume().catch(function () {});
    }
    return audioCtx;
  }

  function beep(count, baseFreq, step) {
    var ctx = ensureAudio();
    if (!ctx) return;
    var start = ctx.currentTime + 0.02;
    var freq = baseFreq || 880;
    var gap = step || 0.26;
    for (var i = 0; i < (count || 3); i++) {
      var t = start + i * gap;
      var osc = ctx.createOscillator();
      var gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, t);
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.32, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.24);
    }
  }

  function vibrate(pattern) {
    if (navigator.vibrate) {
      try {
        navigator.vibrate(pattern);
      } catch (err) {
        /* ignore */
      }
    }
  }

  function notify(title, body) {
    if (!('Notification' in window)) return;
    if (Notification.permission !== 'granted') return;
    try {
      new Notification(title, {
        body: body,
        icon: 'icons/icon-192.png',
        badge: 'icons/icon-192.png',
        tag: 'timer-alert',
        renotify: true
      });
    } catch (err) {
      /* ignore */
    }
  }

  function flashVisual() {
    els.flash.classList.remove('active');
    void els.flash.offsetWidth;
    els.flash.classList.add('active');
    els.badge.hidden = false;
    document.body.classList.add('reminding');
    window.clearTimeout(flashTimer);
    flashTimer = window.setTimeout(clearReminderVisual, 1400);
  }

  function clearReminderVisual() {
    els.flash.classList.remove('active');
    els.badge.hidden = true;
    document.body.classList.remove('reminding');
  }

  function fireReminder(message) {
    beep(3, 880, 0.26);
    vibrate([220, 120, 220, 120, 220]);
    notify('Напоминание', message);
    flashVisual();
    showToast(message);
  }

  function fireFinish() {
    beep(5, 660, 0.18);
    vibrate([400, 160, 400, 160, 600]);
    notify('Таймер завершён', 'Общее время истекло.');
    flashVisual();
    showToast('Время вышло');
  }

  /* ------------------------------------------------------------------ */
  /* Timer core                                                          */
  /* ------------------------------------------------------------------ */

  function renderTime() {
    var text = formatTime(state.remainingMs);
    els.digits.textContent = text;
    els.digits.classList.toggle('is-low', state.remainingMs > 0 && state.remainingMs <= 10000);
    if (state.running) {
      document.title = text + ' — Таймер';
    }
  }

  function updateRing() {
    var progress = state.totalMs > 0 ? clamp(state.remainingMs / state.totalMs, 0, 1) : 0;
    els.ring.style.strokeDashoffset = String(RING_LENGTH * (1 - progress));
  }

  function updateControls() {
    els.btnStart.disabled = state.running;
    els.btnPause.disabled = !state.running;
    els.hours.disabled = state.running;
    els.minutes.disabled = state.running;
    els.seconds.disabled = state.running;
  }

  function currentReminderIndex() {
    if (!els.remindToggle.checked) return 0;
    var intervalMs = readIntervalMinutes() * 60000;
    var elapsed = state.totalMs - state.remainingMs;
    if (elapsed <= 0) return 0;
    return Math.floor(elapsed / intervalMs);
  }

  function maybeRemind() {
    if (!els.remindToggle.checked) return;
    var intervalMin = readIntervalMinutes();
    var intervalMs = intervalMin * 60000;
    var elapsed = state.totalMs - state.remainingMs;
    var index = Math.floor(elapsed / intervalMs);
    if (index > state.lastReminderIndex && index >= 1) {
      var passedMin = index * intervalMin;
      state.lastReminderIndex = index;
      fireReminder('Прошло ' + passedMin + ' мин. Осталось ' + formatTime(state.remainingMs) + '.');
    }
  }

  function tick() {
    if (!state.running) return;
    state.remainingMs = state.endTime - Date.now();

    if (state.remainingMs <= 0) {
      state.remainingMs = 0;
      state.running = false;
      window.clearInterval(state.timerId);
      renderTime();
      updateRing();
      updateControls();
      els.status.textContent = 'Время вышло';
      document.title = 'Время вышло — Таймер';
      fireFinish();
      return;
    }

    maybeRemind();
    renderTime();
    updateRing();
  }

  function start() {
    if (state.running) return;

    if (state.remainingMs <= 0) {
      reset();
    }
    if (state.remainingMs <= 0) {
      showToast('Задайте время больше нуля');
      return;
    }

    ensureAudio();
    state.running = true;
    state.endTime = Date.now() + state.remainingMs;
    state.lastReminderIndex = currentReminderIndex();
    clearReminderVisual();

    window.clearInterval(state.timerId);
    state.timerId = window.setInterval(tick, 200);

    els.status.textContent = 'Идёт отсчёт';
    updateControls();
    renderTime();
  }

  function pause() {
    if (!state.running) return;
    state.remainingMs = Math.max(0, state.endTime - Date.now());
    state.running = false;
    window.clearInterval(state.timerId);
    els.status.textContent = 'Пауза';
    updateControls();
    renderTime();
    updateRing();
    document.title = formatTime(state.remainingMs) + ' — Таймер';
  }

  function reset() {
    state.running = false;
    window.clearInterval(state.timerId);
    state.totalMs = readInputsMs();
    state.remainingMs = state.totalMs;
    state.lastReminderIndex = 0;
    clearReminderVisual();
    renderTime();
    updateRing();
    updateControls();
    els.status.textContent = state.totalMs > 0 ? 'Готов к запуску' : 'Задайте время';
    document.title = 'Таймер';
    saveSettings();
  }

  function applyInputsWhileIdle() {
    if (state.running) return;
    state.totalMs = readInputsMs();
    state.remainingMs = state.totalMs;
    state.lastReminderIndex = 0;
    renderTime();
    updateRing();
    els.status.textContent = state.totalMs > 0 ? 'Готов к запуску' : 'Задайте время';
    saveSettings();
  }

  /* ------------------------------------------------------------------ */
  /* Reminder controls                                                   */
  /* ------------------------------------------------------------------ */

  function syncRemindUI() {
    var on = els.remindToggle.checked;
    els.remindInterval.disabled = !on || state.running;
    els.remindIntervalWrap.classList.toggle('is-disabled', !on);
    if (state.running) {
      state.lastReminderIndex = currentReminderIndex();
    }
  }

  function updateNotifyUI() {
    var supported = 'Notification' in window;
    if (!supported) {
      els.notifyBtn.disabled = true;
      els.notifyBtn.classList.remove('is-on');
      els.notifyHint.textContent = 'Системные уведомления не поддерживаются этим браузером.';
      return;
    }
    if (Notification.permission === 'granted') {
      els.notifyBtn.disabled = true;
      els.notifyBtn.classList.add('is-on');
      els.notifyBtn.textContent = 'Уведомления включены';
      els.notifyHint.textContent = 'Системные уведомления включены.';
    } else if (Notification.permission === 'denied') {
      els.notifyBtn.classList.remove('is-on');
      els.notifyBtn.textContent = 'Уведомления запрещены';
      els.notifyHint.textContent = 'Уведомления запрещены в настройках браузера. Сигнал и вибрация всё равно сработают.';
    } else {
      els.notifyBtn.classList.remove('is-on');
      els.notifyBtn.textContent = 'Включить уведомления';
      els.notifyHint.textContent = 'Системные уведомления не включены.';
    }
  }

  function requestNotifications() {
    if (!('Notification' in window)) return;
    Notification.requestPermission().then(function () {
      updateNotifyUI();
    });
  }

  /* ------------------------------------------------------------------ */
  /* Scenarios                                                           */
  /* ------------------------------------------------------------------ */

  function loadScenarios() {
    try {
      var raw = localStorage.getItem(STORAGE_SCENARIOS);
      var parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch (err) {
      return [];
    }
  }

  function persistScenarios(list) {
    try {
      localStorage.setItem(STORAGE_SCENARIOS, JSON.stringify(list));
    } catch (err) {
      showToast('Не удалось сохранить: хранилище недоступно');
    }
  }

  function makeId() {
    return 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  function addScenario() {
    var name = els.scenarioName.value.trim();
    var totalMs = readInputsMs();
    if (totalMs <= 0) {
      showToast('Задайте время больше нуля');
      return;
    }
    var list = loadScenarios();
    if (!name) name = 'Сценарий ' + (list.length + 1);

    list.push({
      id: makeId(),
      name: name,
      totalMs: totalMs,
      remind: els.remindToggle.checked,
      intervalMin: readIntervalMinutes(),
      createdAt: Date.now()
    });
    persistScenarios(list);
    els.scenarioName.value = '';
    renderScenarios();
    showToast('Сценарий сохранён');
  }

  function runScenario(id) {
    var list = loadScenarios();
    var item = list.filter(function (s) { return s.id === id; })[0];
    if (!item) return;

    state.running = false;
    window.clearInterval(state.timerId);
    clearReminderVisual();

    els.remindToggle.checked = !!item.remind;
    els.remindInterval.value = String(item.intervalMin || 5);
    setInputsFromMs(item.totalMs);
    state.totalMs = item.totalMs;
    state.remainingMs = item.totalMs;
    state.lastReminderIndex = 0;

    syncRemindUI();
    renderTime();
    updateRing();
    updateControls();
    els.status.textContent = 'Запущено: ' + item.name;
    start();
  }

  function renameScenario(id) {
    var list = loadScenarios();
    var item = list.filter(function (s) { return s.id === id; })[0];
    if (!item) return;
    var next = window.prompt('Новое имя сценария:', item.name);
    if (next === null) return;
    next = next.trim();
    if (!next) return;
    item.name = next;
    persistScenarios(list);
    renderScenarios();
  }

  function deleteScenario(id) {
    var list = loadScenarios();
    var item = list.filter(function (s) { return s.id === id; })[0];
    if (!item) return;
    if (!window.confirm('Удалить сценарий «' + item.name + '»?')) return;
    persistScenarios(list.filter(function (s) { return s.id !== id; }));
    renderScenarios();
    showToast('Сценарий удалён');
  }

  function makeActionButton(label, className, onClick) {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'icon-btn' + (className ? ' ' + className : '');
    btn.textContent = label;
    btn.addEventListener('click', onClick);
    return btn;
  }

  function renderScenarios() {
    var list = loadScenarios();
    els.scenarioList.textContent = '';
    els.emptyHint.hidden = list.length > 0;

    list.forEach(function (item) {
      var li = document.createElement('li');
      li.className = 'scenario-item';

      var info = document.createElement('div');
      info.className = 'scenario-info';

      var name = document.createElement('span');
      name.className = 'scenario-name';
      name.textContent = item.name;

      var meta = document.createElement('span');
      meta.className = 'scenario-meta';
      var metaText = humanDuration(item.totalMs);
      if (item.remind) {
        metaText += ' · напоминание каждые ' + (item.intervalMin || 5) + ' мин';
      }
      meta.textContent = metaText;

      info.appendChild(name);
      info.appendChild(meta);

      var actions = document.createElement('div');
      actions.className = 'scenario-actions';
      actions.appendChild(makeActionButton('Запустить', 'run', function () { runScenario(item.id); }));
      actions.appendChild(makeActionButton('Переименовать', '', function () { renameScenario(item.id); }));
      actions.appendChild(makeActionButton('Удалить', 'danger', function () { deleteScenario(item.id); }));

      li.appendChild(info);
      li.appendChild(actions);
      els.scenarioList.appendChild(li);
    });
  }

  /* ------------------------------------------------------------------ */
  /* Settings persistence                                                */
  /* ------------------------------------------------------------------ */

  function saveSettings() {
    try {
      localStorage.setItem(STORAGE_SETTINGS, JSON.stringify({
        totalMs: state.totalMs,
        remind: els.remindToggle.checked,
        intervalMin: readIntervalMinutes()
      }));
    } catch (err) {
      /* ignore */
    }
  }

  function loadSettings() {
    try {
      var raw = localStorage.getItem(STORAGE_SETTINGS);
      if (!raw) return;
      var data = JSON.parse(raw);
      if (typeof data.totalMs === 'number' && data.totalMs > 0) {
        setInputsFromMs(data.totalMs);
      }
      if (typeof data.remind === 'boolean') {
        els.remindToggle.checked = data.remind;
      }
      if (typeof data.intervalMin === 'number') {
        els.remindInterval.value = String(clamp(Math.round(data.intervalMin), 1, 999));
      }
    } catch (err) {
      /* ignore */
    }
  }

  /* ------------------------------------------------------------------ */
  /* Events                                                              */
  /* ------------------------------------------------------------------ */

  els.btnStart.addEventListener('click', start);
  els.btnPause.addEventListener('click', pause);
  els.btnReset.addEventListener('click', reset);

  [els.hours, els.minutes, els.seconds].forEach(function (input) {
    input.addEventListener('input', applyInputsWhileIdle);
    input.addEventListener('change', function () {
      if (!input.disabled) applyInputsWhileIdle();
    });
  });

  els.remindToggle.addEventListener('change', function () {
    syncRemindUI();
    if (state.running) state.lastReminderIndex = currentReminderIndex();
    saveSettings();
  });

  els.remindInterval.addEventListener('change', function () {
    els.remindInterval.value = String(readIntervalMinutes());
    syncRemindUI();
    saveSettings();
  });

  els.notifyBtn.addEventListener('click', requestNotifications);

  els.btnSave.addEventListener('click', addScenario);
  els.scenarioName.addEventListener('keydown', function (event) {
    if (event.key === 'Enter') {
      event.preventDefault();
      addScenario();
    }
  });

  document.querySelectorAll('[data-preset]').forEach(function (chip) {
    chip.addEventListener('click', function () {
      if (state.running) return;
      var seconds = parseInt(chip.getAttribute('data-preset'), 10) || 0;
      setInputsFromMs(seconds * 1000);
      applyInputsWhileIdle();
    });
  });

  document.addEventListener('keydown', function (event) {
    if (event.target && /INPUT|TEXTAREA/.test(event.target.tagName)) return;
    if (event.code === 'Space') {
      event.preventDefault();
      if (state.running) pause();
      else start();
    } else if (event.key === 'r' || event.key === 'R' || event.key === 'к' || event.key === 'К') {
      reset();
    }
  });

  document.addEventListener('visibilitychange', function () {
    if (!document.hidden && state.running) tick();
  });

  /* ------------------------------------------------------------------ */
  /* Service worker                                                      */
  /* ------------------------------------------------------------------ */

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('sw.js').catch(function (err) {
        if (window.console) console.warn('SW registration failed:', err);
      });
    });
  }

  /* ------------------------------------------------------------------ */
  /* Init                                                                */
  /* ------------------------------------------------------------------ */

  els.badge.hidden = true;
  loadSettings();
  state.totalMs = readInputsMs();
  state.remainingMs = state.totalMs;
  state.lastReminderIndex = 0;
  renderTime();
  updateRing();
  updateControls();
  syncRemindUI();
  updateNotifyUI();
  renderScenarios();
  els.status.textContent = state.totalMs > 0 ? 'Готов к запуску' : 'Задайте время';
})();
