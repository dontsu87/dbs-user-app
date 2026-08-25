/**
 * 利用者向け請求予定・利用状況ビューア (app.js)
 *
 * 外部CDNやフレームワークを使わず、素のJavaScriptのみで動作する。
 * XSS脆弱性を防ぐため、innerHTML は一切使用せず textContent と createElement でDOMを構築する。
 * 外部URLは直接記述せず、window.__DBSCP_CONFIG__ (config.js) から取得した apiUrl に接続する。
 */

document.addEventListener("DOMContentLoaded", () => {
  const loadingEl = document.getElementById("loading");
  const errorContainerEl = document.getElementById("error-container");
  const errorMessageEl = document.getElementById("error-message");
  const loginContainerEl = document.getElementById("login-container");
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

  function showError(message, onRetry, retryLabel) {
    loadingEl.classList.add("hidden");
    contentContainerEl.classList.add("hidden");
    if (loginContainerEl) {
      loginContainerEl.classList.add("hidden");
    }
    errorMessageEl.textContent = message;

    const existingRetryBtn = errorContainerEl.querySelector(".retry-btn");
    if (existingRetryBtn) {
      existingRetryBtn.remove();
    }

    if (typeof onRetry === "function") {
      const retryBtn = document.createElement("button");
      retryBtn.className = "btn btn-secondary retry-btn";
      retryBtn.style.marginTop = "1rem";
      retryBtn.textContent = retryLabel || "再試行する";
      retryBtn.addEventListener("click", () => {
        errorContainerEl.classList.add("hidden");
        onRetry();
      });
      errorContainerEl.appendChild(retryBtn);
    }

    errorContainerEl.classList.remove("hidden");
  }

  // ログインフォーム表示
  // 鍵を持たない新規訪問者や、マジックリンクの有効期限切れ時に呼び出される
  function showLoginForm(initialMessage) {
    loadingEl.classList.add("hidden");
    errorContainerEl.classList.add("hidden");
    contentContainerEl.classList.add("hidden");
    if (!loginContainerEl) {
      return;
    }

    loginContainerEl.textContent = "";

    const titleEl = document.createElement("h2");
    titleEl.className = "section-title";
    titleEl.textContent = "メールアドレスでログイン";
    loginContainerEl.appendChild(titleEl);

    if (initialMessage) {
      const noticeEl = document.createElement("p");
      noticeEl.className = "line-meta";
      noticeEl.style.color = "#c53030";
      noticeEl.style.marginBottom = "1rem";
      noticeEl.textContent = initialMessage;
      loginContainerEl.appendChild(noticeEl);
    }

    const descEl = document.createElement("p");
    descEl.className = "line-meta";
    descEl.style.marginBottom = "1rem";
    descEl.textContent = "登録されているメールアドレスを入力してください。ログイン用のリンクをお送りします。";
    loginContainerEl.appendChild(descEl);

    const formEl = document.createElement("form");

    const inputEl = document.createElement("input");
    inputEl.type = "email";
    inputEl.name = "email";
    inputEl.placeholder = "example@example.com";
    inputEl.required = true;
    inputEl.style.width = "100%";
    inputEl.style.padding = "0.6rem";
    inputEl.style.marginBottom = "0.75rem";
    inputEl.style.border = "1px solid #cbd5e0";
    inputEl.style.borderRadius = "4px";
    inputEl.style.fontSize = "1rem";

    const submitBtn = document.createElement("button");
    submitBtn.type = "submit";
    submitBtn.className = "btn btn-secondary";
    submitBtn.textContent = "ログイン用リンクを送信";

    const resultMsgEl = document.createElement("p");
    resultMsgEl.className = "line-meta";
    resultMsgEl.style.marginTop = "1rem";

    formEl.appendChild(inputEl);
    formEl.appendChild(submitBtn);

    formEl.addEventListener("submit", (e) => {
      e.preventDefault();
      const email = inputEl.value.trim();
      if (!email) {
        return;
      }

      // 二重送信を防止
      submitBtn.disabled = true;
      inputEl.disabled = true;
      submitBtn.textContent = "送信中...";
      resultMsgEl.textContent = "";

      const config = window.__DBSCP_CONFIG__;
      if (!config || !config.apiUrl) {
        submitBtn.disabled = false;
        inputEl.disabled = false;
        submitBtn.textContent = "ログイン用リンクを送信";
        resultMsgEl.textContent = "配信設定（config.js）が読み込まれていません。";
        resultMsgEl.style.color = "#c53030";
        return;
      }

      const endpoint = config.apiUrl + "/v1/auth/request";

      fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ email: email }),
      })
        .then((res) => {
          // Worker側は存在探知防止のため、登録有無やレート制限中にかかわらず 202 を返す。
          // フロントエンドでも登録の有無による文言の差分を作らず統一した案内を表示する。
          if (res.ok || res.status === 200 || res.status === 202) {
            inputEl.classList.add("hidden");
            submitBtn.classList.add("hidden");
            descEl.classList.add("hidden");
            resultMsgEl.textContent =
              "入力されたアドレスが登録されていれば、ログイン用のリンクをお送りします。メールをご確認ください（届くまで数分かかる場合があります）。";
            resultMsgEl.style.color = "#2b6cb0";
            resultMsgEl.style.fontWeight = "600";
          } else {
            // 通信障害・サーバ異常などの場合のみ再試行案内を出す
            submitBtn.disabled = false;
            inputEl.disabled = false;
            submitBtn.textContent = "ログイン用リンクを送信";
            resultMsgEl.textContent = "送信できませんでした。しばらくしてから再試行してください。";
            resultMsgEl.style.color = "#c53030";
          }
        })
        .catch(() => {
          submitBtn.disabled = false;
          inputEl.disabled = false;
          submitBtn.textContent = "ログイン用リンクを送信";
          resultMsgEl.textContent = "送信できませんでした。しばらくしてから再試行してください。";
          resultMsgEl.style.color = "#c53030";
        });
    });

    loginContainerEl.appendChild(formEl);
    loginContainerEl.appendChild(resultMsgEl);
    loginContainerEl.classList.remove("hidden");
  }

  // ログイン確認画面の表示
  // メールセキュリティ（Safe Links 等）のリンクスキャン機能による自動アクセスで
  // 使い捨てトークンが誤消費されるのを防ぐため、即時検証せず利用者の明示的なボタン操作を挟む。
  function showLoginConfirm(token) {
    loadingEl.classList.add("hidden");
    errorContainerEl.classList.add("hidden");
    contentContainerEl.classList.add("hidden");
    if (!loginContainerEl) {
      return;
    }

    loginContainerEl.textContent = "";

    const titleEl = document.createElement("h2");
    titleEl.className = "section-title";
    titleEl.textContent = "ログインの確認";
    loginContainerEl.appendChild(titleEl);

    const descEl = document.createElement("p");
    descEl.className = "line-meta";
    descEl.style.marginBottom = "1rem";
    descEl.textContent = "以下のボタンを押してログインを完了してください。";
    loginContainerEl.appendChild(descEl);

    const confirmBtn = document.createElement("button");
    confirmBtn.type = "button";
    confirmBtn.className = "btn btn-secondary";
    confirmBtn.textContent = "ログインする";

    confirmBtn.addEventListener("click", () => {
      confirmBtn.disabled = true;
      confirmBtn.textContent = "確認中...";
      verifyLoginToken(token);
    });

    loginContainerEl.appendChild(confirmBtn);
    loginContainerEl.classList.remove("hidden");
  }

  // マジックリンクトークンの検証 (/v1/auth/verify)
  function verifyLoginToken(token) {
    loadingEl.classList.remove("hidden");
    errorContainerEl.classList.add("hidden");
    if (loginContainerEl) {
      loginContainerEl.classList.add("hidden");
    }
    contentContainerEl.classList.add("hidden");

    const config = window.__DBSCP_CONFIG__;
    if (!config || !config.apiUrl) {
      showError("配信設定（config.js）が読み込まれていません。");
      return;
    }

    const endpoint = config.apiUrl + "/v1/auth/verify";

    fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ token: token }),
    })
      .then((res) => {
        if (res.status === 200) {
          return res.json().then((data) => {
            const sessionToken = data && data.session_token;
            if (sessionToken && typeof sessionToken === "string") {
              try {
                localStorage.setItem("dbscp.key", sessionToken);
              } catch {
                // localStorage が利用できない環境でもメモリ上の鍵で動作を継続
              }
              fetchBillingView(sessionToken);
            } else {
              showError("ログイン検証の応答が不正です。");
            }
          });
        }
        if (res.status === 401) {
          // リンクの有効期限切れまたは使用済み
          showLoginForm("リンクの有効期限が切れています。再度ログインしてください。");
          return;
        }
        if (res.status === 403) {
          // 未プロビジョニング: リンク再送で解決しないため再試行導線は出さない
          showError("このメールアドレスにはまだ閲覧対象のデータが登録されていません。");
          return;
        }
        showError(`ログイン検証に失敗しました。(ステータス: ${res.status})`, () => {
          verifyLoginToken(token);
        });
      })
      .catch(() => {
        showError("ログイン検証中に通信エラーが発生しました。", () => {
          verifyLoginToken(token);
        });
      });
  }

  // 単一HTMLとして書き出したときは、データがページ内に埋め込まれている。
  // その場合はネットワークを使わない（ファイルを直接開いても動くようにするため）。
  // file:// では fetch が使えないので、この分岐が無いと手元で開けない。
  const embedded = window.__DBSCP_VIEW__;
  if (embedded && typeof embedded === "object") {
    renderPayload(embedded);
    return;
  }

  // 鍵をURLのハッシュ（#）で渡す理由:
  // ハッシュフラグメントはHTTPリクエスト時にサーバへ送信されないため、
  // Workerのアクセスログや外部参照時のRefererヘッダに鍵が残らない。
  // クエリパラメータで渡すとサーバログやRefererに記録されてしまい漏洩の危険がある。
  const hashRaw = window.location.hash.startsWith("#")
    ? window.location.hash.slice(1)
    : window.location.hash;
  const hashParams = new URLSearchParams(hashRaw);
  const loginParam = hashParams.get("login");
  const keyParam = hashParams.get("k");

  // 1. マジックリンクによるログイン (#login=<token>)
  if (loginParam && loginParam.trim()) {
    // URLのハッシュからトークンを消去して履歴を置換
    const cleanUrl = window.location.pathname + window.location.search;
    window.history.replaceState(null, "", cleanUrl);
    showLoginConfirm(loginParam.trim());
    return;
  }

  let authKey = null;

  // 2. 招待キーによるアクセス (#k=<鍵>)
  if (keyParam && keyParam.trim()) {
    authKey = keyParam.trim();
    try {
      localStorage.setItem("dbscp.key", authKey);
    } catch {
      // localStorage が利用できない環境でもメモリ上の鍵で動作を継続
    }
    // URLのハッシュから鍵を消去して履歴を置換
    const cleanUrl = window.location.pathname + window.location.search;
    window.history.replaceState(null, "", cleanUrl);
  } else {
    // 3. localStorage に保存済みの鍵
    try {
      authKey = localStorage.getItem("dbscp.key");
    } catch {
      authKey = null;
    }
  }

  // 4. 鍵が見つからない場合はログインフォームを表示
  if (!authKey || !authKey.trim()) {
    showLoginForm();
    return;
  }

  fetchBillingView(authKey.trim());

  function fetchBillingView(key) {
    const config = window.__DBSCP_CONFIG__;
    if (!config || !config.apiUrl) {
      showError("配信設定（config.js）が読み込まれていません。");
      return;
    }

    const endpoint = config.apiUrl + "/v1/view";

    fetch(endpoint, {
      headers: {
        Authorization: "Bearer " + key,
      },
    })
      .then((res) => {
        if (res.status === 200) {
          return res.json().then((payload) => {
            renderPayload(payload);
          });
        }
        if (res.status === 401) {
          try {
            localStorage.removeItem("dbscp.key");
          } catch {
            // ignore
          }
          showError(
            "鍵が正しくありません。正しい招待リンクから再度アクセスするか、メールアドレスでログインしてください。",
            () => {
              showLoginForm();
            },
            "ログイン画面へ"
          );
          return;
        }
        if (res.status === 404) {
          showError("まだ請求予定が配信されていません。");
          return;
        }
        showError(`請求予定データを取得できませんでした。(ステータス: ${res.status})`, () => {
          fetchBillingView(key);
        });
      })
      .catch(() => {
        showError("請求予定データの取得中に通信エラーが発生しました。", () => {
          fetchBillingView(key);
        });
      });
  }

  function renderPayload(payload) {
    loadingEl.classList.add("hidden");
    if (loginContainerEl) {
      loginContainerEl.classList.add("hidden");
    }
    errorContainerEl.classList.add("hidden");

    if (!payload || typeof payload !== "object") {
      showError("無効なデータフォーマットです。");
      return;
    }

    targetMonthEl.textContent = payload.target_month ? `${payload.target_month} 利用分` : "当月利用分";

    // ドコモ・バイクシェア側の契約プラン一覧に実際に表示される名前を優先する。
    // 依頼者にとって内部のプラン定義バージョン(plan_version)は意味を持たないため。
    // 取得できていない古いデータ(portal_plan_name が空)では、従来どおり
    // 内部バージョンを表示してフォールバックする（表示が空白になるよりよい）。
    if (payload.portal_plan_name) {
      planVersionEl.textContent = `ご契約プラン: ${payload.portal_plan_name}`;
    } else {
      planVersionEl.textContent = payload.plan_version ? `プラン: ${payload.plan_version}` : "";
    }

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
