(function () {
  "use strict";

  var TIERS = [200, 400, 600, 800, 1000];
  var STORAGE_KEY = "family-trivia-state-v4";
  var categories = window.TRIVIA_DATA.categories;

  var HELPER_TYPES = [
    { key: "changeQuestion", icon: "🔄", label: "تغيير السؤال" },
    { key: "hint", icon: "💡", label: "تلميح" },
    { key: "double", icon: "٢×", label: "مضاعفة النقاط" }
  ];

  var boardEl = document.querySelector("[data-board]");
  var modalBackdrop = document.querySelector("[data-modal-backdrop]");
  var modalCategory = document.querySelector("[data-modal-category]");
  var modalPoints = document.querySelector("[data-modal-points]");
  var modalQuestion = document.querySelector("[data-modal-question]");
  var modalAnswer = document.querySelector("[data-modal-answer]");
  var modalAnswerText = document.querySelector("[data-modal-answer-text]");
  var revealBtn = document.querySelector("[data-reveal-answer]");
  var modalActions = document.querySelector("[data-modal-actions]");
  var turnIndicatorName = document.querySelector("[data-turn-team-name]");
  var endgameBackdrop = document.querySelector("[data-endgame-backdrop]");
  var endgameResult = document.querySelector("[data-endgame-result]");
  var endgameCloseBtn = document.querySelector("[data-endgame-close]");
  var resetBtn = document.querySelector("[data-reset-game]");
  var cancelBtn = document.querySelector("[data-cancel-cell]");
  var teamNameInputs = document.querySelectorAll("[data-team-name]");
  var teamScoreEls = document.querySelectorAll("[data-team-score]");
  var awardButtons = document.querySelectorAll("[data-award]");
  var helpersRow = document.querySelector("[data-helpers-row]");
  var hintBox = document.querySelector("[data-hint-box]");

  var state = loadState();
  var openCell = null; // { catId, tier }
  var currentPool = null; // the 10-question pool for the open cell
  var currentQuestion = null; // the specific question currently shown
  var doubleActive = { 0: false, 1: false }; // per-team double-points flag for the open question

  function defaultHelpers() {
    return [
      { changeQuestion: 2, hint: 2, double: 2 },
      { changeQuestion: 2, hint: 2, double: 2 }
    ];
  }

  function defaultState() {
    return {
      teamNames: ["الفريق الأزرق", "الفريق الأحمر"],
      scores: [0, 0],
      turn: 0,
      used: {}, // key "catId-tier" -> true
      helpers: defaultHelpers() // per-team lifeline counters, 2 uses each
    };
  }

  function loadState() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        var parsed = JSON.parse(raw);
        if (parsed && parsed.scores && parsed.used) {
          if (!parsed.helpers) parsed.helpers = defaultHelpers();
          return parsed;
        }
      }
    } catch (e) {
      /* ignore corrupt/unavailable storage */
    }
    return defaultState();
  }

  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
      /* ignore */
    }
  }

  function cellKey(catId, tier) {
    return catId + "-" + tier;
  }

  function renderScores() {
    teamScoreEls.forEach(function (el) {
      var i = Number(el.getAttribute("data-team-score"));
      el.textContent = state.scores[i];
    });
    teamNameInputs.forEach(function (input) {
      var i = Number(input.getAttribute("data-team-name"));
      if (document.activeElement !== input) input.value = state.teamNames[i];
    });
    turnIndicatorName.textContent = state.teamNames[state.turn];
  }

  function buildBoard() {
    boardEl.innerHTML = "";

    // Each category is rendered as its own self-contained group (name +
    // its 5 point buttons), so the layout can never misalign a category
    // label from its buttons regardless of screen width — unlike a single
    // 6-column grid, which breaks if the column count is changed responsively.
    categories.forEach(function (cat) {
      var group = document.createElement("div");
      group.className = "category-group";

      var header = document.createElement("div");
      header.className = "board-cat-header";
      header.textContent = cat.name;
      group.appendChild(header);

      var row = document.createElement("div");
      row.className = "category-row";

      TIERS.forEach(function (tier) {
        var btn = document.createElement("button");
        btn.type = "button";
        btn.className = "board-cell";
        var used = !!state.used[cellKey(cat.id, tier)];
        btn.disabled = used;
        btn.textContent = used ? "" : String(tier);
        btn.setAttribute("data-cat", cat.id);
        btn.setAttribute("data-tier", String(tier));
        btn.setAttribute(
          "aria-label",
          used ? "سؤال مستخدم" : cat.name + " — " + tier + " نقطة"
        );
        btn.addEventListener("click", onCellClick);
        row.appendChild(btn);
      });

      group.appendChild(row);
      boardEl.appendChild(group);
    });
  }

  function onCellClick(event) {
    var btn = event.currentTarget;
    var catId = btn.getAttribute("data-cat");
    var tier = Number(btn.getAttribute("data-tier"));
    var cat = categories.filter(function (c) { return c.id === catId; })[0];
    var pool = cat.tiers[tier];

    openCell = { catId: catId, tier: tier };
    currentPool = pool;
    currentQuestion = pool[Math.floor(Math.random() * pool.length)];
    doubleActive = { 0: false, 1: false };

    modalCategory.textContent = cat.name;
    modalPoints.textContent = tier + " نقطة";
    modalQuestion.textContent = currentQuestion.q;
    modalAnswerText.textContent = currentQuestion.a;
    modalAnswer.hidden = true;
    modalActions.hidden = true;
    revealBtn.hidden = false;
    hintBox.hidden = true;
    hintBox.textContent = "";

    awardButtons.forEach(function (b) {
      var i = b.getAttribute("data-award");
      if (i === "0" || i === "1") {
        b.textContent = state.teamNames[Number(i)] + " ✅";
      }
    });

    renderHelpers();
    modalBackdrop.hidden = false;
  }

  function closeModal() {
    modalBackdrop.hidden = true;
    openCell = null;
    currentPool = null;
    currentQuestion = null;
    doubleActive = { 0: false, 1: false };
  }

  var OPTION_LETTERS = ["أ", "ب", "ج"];

  function buildHintOptions(catId, correctAnswer) {
    var cat = categories.filter(function (c) {
      return c.id === catId;
    })[0];

    var otherAnswers = [];
    TIERS.forEach(function (tier) {
      cat.tiers[tier].forEach(function (item) {
        if (item.a !== correctAnswer && otherAnswers.indexOf(item.a) === -1) {
          otherAnswers.push(item.a);
        }
      });
    });

    var decoys = [];
    while (decoys.length < 2 && otherAnswers.length > 0) {
      var idx = Math.floor(Math.random() * otherAnswers.length);
      decoys.push(otherAnswers.splice(idx, 1)[0]);
    }

    var options = decoys.concat([correctAnswer]);
    for (var i = options.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var tmp = options[i];
      options[i] = options[j];
      options[j] = tmp;
    }
    return options;
  }

  function useHelper(teamIndex, key) {
    if (!openCell || !currentQuestion) return;
    if (state.helpers[teamIndex][key] <= 0) return;
    if (key === "double" && doubleActive[teamIndex]) return;

    state.helpers[teamIndex][key] -= 1;

    if (key === "changeQuestion") {
      var alternatives = currentPool.filter(function (q) {
        return q.q !== currentQuestion.q;
      });
      if (alternatives.length > 0) {
        currentQuestion = alternatives[Math.floor(Math.random() * alternatives.length)];
        modalQuestion.textContent = currentQuestion.q;
        modalAnswerText.textContent = currentQuestion.a;
        hintBox.hidden = true;
        hintBox.textContent = "";
        modalAnswer.hidden = true;
        modalActions.hidden = true;
        revealBtn.hidden = false;
      }
    } else if (key === "hint") {
      var options = buildHintOptions(openCell.catId, currentQuestion.a);
      var lines = options.map(function (opt, idx) {
        return OPTION_LETTERS[idx] + ") " + opt;
      });
      hintBox.innerHTML =
        "💡 اختر الإجابة الصحيحة:<br>" + lines.join("<br>");
      hintBox.hidden = false;
    } else if (key === "double") {
      doubleActive[teamIndex] = true;
    }

    saveState();
    renderHelpers();
  }

  function renderHelpers() {
    helpersRow.innerHTML = "";

    [0, 1].forEach(function (teamIndex) {
      var teamWrap = document.createElement("div");
      teamWrap.className = "helpers-team helpers-team--" + (teamIndex + 1);

      var label = document.createElement("span");
      label.className = "helpers-team-label";
      label.textContent =
        state.teamNames[teamIndex] + (doubleActive[teamIndex] ? " (مضاعفة مفعّلة)" : "");
      teamWrap.appendChild(label);

      var btnsWrap = document.createElement("div");
      btnsWrap.className = "helpers-buttons";

      HELPER_TYPES.forEach(function (helper) {
        var remaining = state.helpers[teamIndex][helper.key];
        var btn = document.createElement("button");
        btn.type = "button";
        btn.className = "helper-btn";
        btn.title = helper.label;
        btn.setAttribute("aria-label", helper.label + " — " + state.teamNames[teamIndex]);
        btn.disabled = remaining <= 0 || (helper.key === "double" && doubleActive[teamIndex]);
        btn.innerHTML = helper.icon + '<span class="helper-count">' + remaining + "×</span>";
        btn.addEventListener("click", function () {
          useHelper(teamIndex, helper.key);
        });
        btnsWrap.appendChild(btn);
      });

      teamWrap.appendChild(btnsWrap);
      helpersRow.appendChild(teamWrap);
    });
  }

  cancelBtn.addEventListener("click", closeModal);

  revealBtn.addEventListener("click", function () {
    modalAnswer.hidden = false;
    modalActions.hidden = false;
    revealBtn.hidden = true;
  });

  awardButtons.forEach(function (btn) {
    btn.addEventListener("click", function () {
      if (!openCell) return;
      var award = btn.getAttribute("data-award");
      if (award === "0" || award === "1") {
        var i = Number(award);
        var points = doubleActive[i] ? openCell.tier * 2 : openCell.tier;
        state.scores[i] += points;
      }
      state.used[cellKey(openCell.catId, openCell.tier)] = true;
      state.turn = state.turn === 0 ? 1 : 0;
      saveState();
      closeModal();
      buildBoard();
      renderScores();
      checkGameOver();
    });
  });

  function checkGameOver() {
    var totalCells = categories.length * TIERS.length;
    var usedCount = Object.keys(state.used).length;
    if (usedCount < totalCells) return;

    var result;
    if (state.scores[0] === state.scores[1]) {
      result = "تعادل رائع بين " + state.teamNames[0] + " و" + state.teamNames[1] + "! 🤝";
    } else {
      var winnerIndex = state.scores[0] > state.scores[1] ? 0 : 1;
      result =
        "🏆 الفائز هو " +
        state.teamNames[winnerIndex] +
        " بمجموع " +
        state.scores[winnerIndex] +
        " نقطة!";
    }
    endgameResult.textContent = result;
    endgameBackdrop.hidden = false;
  }

  endgameCloseBtn.addEventListener("click", function () {
    endgameBackdrop.hidden = true;
  });

  teamNameInputs.forEach(function (input) {
    input.addEventListener("input", function () {
      var i = Number(input.getAttribute("data-team-name"));
      state.teamNames[i] = input.value.trim() || state.teamNames[i];
      saveState();
      renderScores();
    });
  });

  resetBtn.addEventListener("click", function () {
    var confirmed = window.confirm("هل تريد إعادة اللعبة من جديد؟ سيتم مسح النقاط وإرجاع كل الأسئلة.");
    if (!confirmed) return;
    var keepNames = state.teamNames;
    state = defaultState();
    state.teamNames = keepNames;
    saveState();
    buildBoard();
    renderScores();
    endgameBackdrop.hidden = true;
    closeModal();
  });

  buildBoard();
  renderScores();
})();
