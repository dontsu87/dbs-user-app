/**
 * 利用者向け請求予定・利用状況ビューア (app.js)
 *
 * 外部CDNやフレームワークを使わず、素のJavaScriptのみで動作する。
 * XSS脆弱性を防ぐため、innerHTML は一切使用せず textContent と createElement でDOMを構築する。
 * 外部ネットワーク通信は行わず、同一オリジン内の views/<token>.json のみを取得する。
 */

document.addEventListener("DOMContentLoaded", () => {
  const loadingEl = document.getElementById("loading");
  const errorContainerEl = document.getElementById("error-container");
  const errorMessageEl = document.getElementById("error-message");
  const contentContainerEl = document.getElementById("content-container");

  const targetMonthEl = document.getElementById("target-month");
  const planVersionEl = document.getElementById("plan-version");
  const totalAmountEl = document.getElementById("total-amount");
  const baselineAmountEl = document.getElementById("baseline-amount");
  const diffAmountEl = document.getElementById("diff-amount");
  const scheduleNoticeEl = document.getElementById("schedule-notice");
  const linesContainerEl = document.getElementById("lines-container");
  const pendingSectionEl = document.getElementById("pending-section");
  const pendingContainerEl = document.getElementById("pending-container");
  const disputeBtn = document.getElementById("dispute-btn");
  const disputeMessageEl = document.getElementById("dispute-message");

  // 金額フォーマット関数 (3桁区切り、負数は -1,234円 と明示)
  function formatYen(val) {
    if (!Number.isFinite(val)) {
      return "表示できません";
    }
    const absStr = Math.abs(val).toLocaleString();
    if (val < 0) {
      return `-${absStr} 円`;
    }
    return `${absStr} 円`;
  }

  // 利用時間フォーマット関数 (分数を "X分間" または "X時間Y分" に変換)
  // 課金計算の根拠（rating_engine）と同じ切り上げ分数（duration_minutes）を受け取る
  function formatDuration(minutes) {
    if (!Number.isFinite(minutes) || minutes < 0) {
      return "";
    }
    if (minutes < 60) {
      return `${minutes}分間`;
    }
    const hours = Math.floor(minutes / 60);
    const remMins = minutes % 60;
    if (remMins === 0) {
      return `${hours}時間`;
    }
    return `${hours}時間${remMins}分`;
  }

  function showError(message) {
    loadingEl.classList.add("hidden");
    contentContainerEl.classList.add("hidden");
    errorMessageEl.textContent = message;
    errorContainerEl.classList.remove("hidden");
  }

  // 単一HTMLとして書き出したときは、データがページ内に埋め込まれている。
  // その場合はネットワークを使わない（ファイルを直接開いても動くようにするため）。
  // file:// では fetch が使えないので、この分岐が無いと手元で開けない。
  const embedded = window.__DBSCP_VIEW__;
  if (embedded && typeof embedded === "object") {
    renderPayload(embedded);
    return;
  }

  // URLパラメータからトークン (t または token) を取得
  const urlParams = new URLSearchParams(window.location.search);
  const token = urlParams.get("t") || urlParams.get("token");

  if (!token || !token.trim()) {
    showError("URLに認証トークン (?t=...) が指定されていません。招待リンクからアクセスしてください。");
    return;
  }

  const cleanToken = token.trim();
  // トークン形式検証 (英数字のみ)
  if (!/^[a-zA-Z0-9_-]+$/.test(cleanToken)) {
    showError("無効なトークン形式です。");
    return;
  }

  const viewUrl = `./views/${encodeURIComponent(cleanToken)}.json`;

  fetch(viewUrl)
    .then((res) => {
      if (!res.ok) {
        throw new Error(`データの取得に失敗しました (ステータス: ${res.status})`);
      }
      return res.json();
    })
    .then((payload) => {
      renderPayload(payload);
    })
    .catch((err) => {
      showError(`請求予定データの読み込みに失敗しました: ${err.message}`);
    });

  function renderPayload(payload) {
    loadingEl.classList.add("hidden");

    if (!payload || typeof payload !== "object") {
      showError("無効なデータフォーマットです。");
      return;
    }

    // 基本サマリー情報
    targetMonthEl.textContent = payload.target_month ? `${payload.target_month} 利用分` : "当月利用分";
    planVersionEl.textContent = payload.plan_version ? `プラン: ${payload.plan_version}` : "";

    // 金額検証と描画
    const totalYen = payload.total_yen;
    const baselineYen = payload.baseline_total_yen;

    totalAmountEl.textContent = formatYen(totalYen);
    baselineAmountEl.textContent = formatYen(baselineYen);

    if (Number.isFinite(totalYen) && Number.isFinite(baselineYen)) {
      const diff = totalYen - baselineYen;
      if (diff < 0) {
        const absDiff = Math.abs(diff).toLocaleString();
        diffAmountEl.textContent = `標準プランより ${absDiff} 円 安い`;
        diffAmountEl.className = "diff-value savings";
      } else if (diff > 0) {
        const absDiff = diff.toLocaleString();
        diffAmountEl.textContent = `標準プランより ${absDiff} 円 高い`;
        diffAmountEl.className = "diff-value expensive";
      } else {
        diffAmountEl.textContent = "標準プランと同額";
        diffAmountEl.className = "diff-value";
      }
    } else {
      diffAmountEl.textContent = "表示できません";
    }

    // 請求スケジュール案内（scheduled_post_at と現在時刻の差分から残り日数を算出）
    if (payload.scheduled_post_at) {
      const scheduledDate = new Date(payload.scheduled_post_at);
      if (!Number.isNaN(scheduledDate.getTime())) {
        const now = new Date();
        const diffMs = scheduledDate.getTime() - now.getTime();
        const remainingDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
        const month = scheduledDate.getMonth() + 1;
        const day = scheduledDate.getDate();

        if (remainingDays > 0) {
          scheduleNoticeEl.textContent = `${month}月${day}日に請求されます（あと${remainingDays}日）`;
        } else {
          scheduleNoticeEl.textContent = "まもなく請求されます";
        }
      } else if (payload.generated_at) {
        scheduleNoticeEl.textContent = `計算日時: ${payload.generated_at}`;
      }
    } else if (payload.generated_at) {
      scheduleNoticeEl.textContent = `計算日時: ${payload.generated_at}`;
    }

    // 明細行の描画
    linesContainerEl.textContent = ""; // リセット
    const lines = Array.isArray(payload.lines) ? payload.lines : [];

    if (lines.length === 0) {
      const emptyMsg = document.createElement("p");
      emptyMsg.textContent = "当月のご利用明細はありません。";
      emptyMsg.className = "line-meta";
      linesContainerEl.appendChild(emptyMsg);
    } else {
      lines.forEach((line, index) => {
        const detailsEl = document.createElement("details");
        detailsEl.className = "line-item";
        // 最初の1行目だけ既定で開いた状態にする
        if (index === 0) {
          detailsEl.open = true;
        }

        const summaryEl = document.createElement("summary");
        summaryEl.className = "line-summary";

        const infoDiv = document.createElement("div");
        infoDiv.className = "line-info";

        const labelSpan = document.createElement("span");
        labelSpan.className = "line-label";
        labelSpan.textContent = line.label || "利用明細";
        infoDiv.appendChild(labelSpan);

        // 付帯情報（利用時間・発生日時など。IDは表示せず名前や分数を表示）
        const detail = line.detail || {};
        const metaParts = [];
        if (Number.isFinite(detail.duration_minutes)) {
          metaParts.push(formatDuration(detail.duration_minutes));
        }
        if (detail.occurred_at) {
          metaParts.push(detail.occurred_at);
        }

        if (metaParts.length > 0) {
          const metaSpan = document.createElement("span");
          metaSpan.className = "line-meta";
          metaSpan.textContent = metaParts.join(" | ");
          infoDiv.appendChild(metaSpan);
        }

        const amountSpan = document.createElement("span");
        amountSpan.className = "line-amount";
        const amt = line.amount_yen;
        amountSpan.textContent = formatYen(amt);
        if (Number.isFinite(amt) && amt < 0) {
          amountSpan.classList.add("discount");
        }

        summaryEl.appendChild(infoDiv);
        summaryEl.appendChild(amountSpan);
        detailsEl.appendChild(summaryEl);

        // 内訳テーブル (components)
        const componentsDiv = document.createElement("div");
        componentsDiv.className = "line-components";

        const components = Array.isArray(line.components) ? line.components : [];
        if (components.length > 0) {
          const table = document.createElement("table");
          table.className = "components-table";

          const thead = document.createElement("thead");
          const trHead = document.createElement("tr");

          const thRule = document.createElement("th");
          thRule.textContent = "適用ルール / 理由";
          const thAmt = document.createElement("th");
          thAmt.textContent = "金額";
          thAmt.style.textAlign = "right";

          trHead.appendChild(thRule);
          trHead.appendChild(thAmt);
          thead.appendChild(trHead);
          table.appendChild(thead);

          const tbody = document.createElement("tbody");
          components.forEach((comp) => {
            const tr = document.createElement("tr");

            const tdRule = document.createElement("td");
            const ruleTitle = document.createElement("div");
            ruleTitle.style.fontWeight = "600";
            ruleTitle.textContent = comp.label || comp.rule_id || "";
            const ruleReason = document.createElement("div");
            ruleReason.className = "line-meta";
            ruleReason.textContent = comp.reason || "";
            tdRule.appendChild(ruleTitle);
            if (comp.reason) {
              tdRule.appendChild(ruleReason);
            }

            const tdAmt = document.createElement("td");
            tdAmt.className = "comp-amount";
            const cAmt = comp.amount_yen;
            tdAmt.textContent = formatYen(cAmt);
            if (Number.isFinite(cAmt) && cAmt < 0) {
              tdAmt.classList.add("discount");
            }

            tr.appendChild(tdRule);
            tr.appendChild(tdAmt);
            tbody.appendChild(tr);
          });
          table.appendChild(tbody);
          componentsDiv.appendChild(table);
        } else {
          const noComp = document.createElement("p");
          noComp.className = "line-meta";
          noComp.textContent = "内訳情報はありません。";
          componentsDiv.appendChild(noComp);
        }

        detailsEl.appendChild(componentsDiv);
        linesContainerEl.appendChild(detailsEl);
      });
    }

    // 確認中の貢献 (pending_contributions) の描画
    const pendingList = Array.isArray(payload.pending_contributions) ? payload.pending_contributions : [];
    if (pendingList.length > 0) {
      pendingContainerEl.textContent = "";
      pendingList.forEach((item) => {
        const itemDiv = document.createElement("div");
        itemDiv.className = "pending-item";

        const headerDiv = document.createElement("div");
        headerDiv.className = "pending-item-header";
        headerDiv.textContent = `申告ID: ${item.declaration_id || ""} (${item.event_type || "貢献活動"})`;
        itemDiv.appendChild(headerDiv);

        if (item.reason) {
          const reasonDiv = document.createElement("div");
          reasonDiv.className = "pending-item-reason";
          reasonDiv.textContent = `確認状況: ${item.reason}`;
          itemDiv.appendChild(reasonDiv);
        }

        if (item.occurred_at) {
          const timeDiv = document.createElement("div");
          timeDiv.className = "line-meta";
          timeDiv.textContent = `発生日時: ${item.occurred_at}`;
          itemDiv.appendChild(timeDiv);
        }

        pendingContainerEl.appendChild(itemDiv);
      });
      pendingSectionEl.classList.remove("hidden");
    } else {
      pendingSectionEl.classList.add("hidden");
    }

    contentContainerEl.classList.remove("hidden");
  }

  // 異議申立ボタンのイベント
  // サーバ未実装の段階で「送信完了」のように見せないため、画面内に準備中メッセージを表示するのみとする
  disputeBtn.addEventListener("click", () => {
    disputeMessageEl.textContent = "現在、Webからの異議申立受付口は準備中です。ご不明な点がございましたら運用管理者へお問い合わせください。";
    disputeMessageEl.classList.remove("hidden");
  });
});
