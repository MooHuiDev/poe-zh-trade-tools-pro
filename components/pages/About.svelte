<script lang="ts">
  import Button from "../Button.svelte";
  import { languageStore, translate } from "../../lib/services/i18n";
  import { hasValidExtensionContext } from "../../lib/utilities/extension-context";
  import { onMount } from "svelte";
  import SvgIcon from "../SvgIcon.svelte";
  import forumIcon from "lucide-static/icons/messages-square.svg?raw";
  import externalIcon from "lucide-static/icons/external-link.svg?raw";
  import closeIcon from "lucide-static/icons/x.svg?raw";

  // Feedback channels shown in the "report a bug / suggest" dialog.
  const FEEDBACK_LINKS = [
    {
      key: "bahamut",
      href: "https://forum.gamer.com.tw/Co.php?bsn=18966&sn=615878",
      svg: forumIcon,
      img: ""
    },
    {
      key: "github",
      href: "https://github.com/MooHuiDev/poe-zh-trade-tools-pro/issues",
      svg: "",
      // same GitHub mark the footer already uses
      img: "https://cdn.simpleicons.org/github/f0e0bf"
    },
    {
      key: "discord",
      href: "https://discord.gg/Y3Zd6DbPjD",
      svg: "",
      img: "https://cdn.simpleicons.org/discord/f0e0bf"
    }
  ] as const;
  const feedbackLabel = (key: string) =>
    translate($languageStore, `about.feedback${key[0].toUpperCase()}${key.slice(1)}`);
  const feedbackHint = (key: string) =>
    translate($languageStore, `about.feedback${key[0].toUpperCase()}${key.slice(1)}Hint`);

  let feedbackOpen = $state(false);
  const closeFeedback = () => (feedbackOpen = false);
  const handleFeedbackBackdrop = (event: MouseEvent) => {
    if (event.target === event.currentTarget) closeFeedback();
  };
  // Esc closes the dialog wherever focus is.
  const handleWindowKeydown = (event: KeyboardEvent) => {
    if (feedbackOpen && event.key === "Escape") closeFeedback();
  };

  let {
    onOpenWhatsNew = () => {},
    onOpenTutorial = () => {}
  }: {
    onOpenWhatsNew?: () => void;
    onOpenTutorial?: () => void;
  } = $props();

  const version = hasValidExtensionContext() ? chrome.runtime.getManifest().version : "dev"

  // Localization "data version" — comes from the remote dictionary JSON, so it
  // can update without a store release (lets users see the latest league the
  // unique names cover).
  let dataVersion = $state<string | null>(null);
  onMount(() => {
    try {
      chrome.storage?.local?.get("zhDataVersion", (r) => {
        const v = (r as { zhDataVersion?: string })?.zhDataVersion;
        if (v) dataVersion = String(v);
      });
    } catch {
      // storage unavailable; just omit the data-version line
    }
  });
</script>

<section class="about-page">
  <header class="hero">
    <div class="eyebrow">{translate($languageStore, "about.eyebrow")}</div>
    <h1>Poe Zh Trade Tools Pro</h1>
    <p>
      {translate($languageStore, "about.description")}
    </p>
  </header>

  <section class="about-section" data-tutorial="settings-tutorial">
    <h2>{translate($languageStore, "settings.onboardingTitle")}</h2>
    <p>{translate($languageStore, "settings.onboardingDescription")}</p>
    <Button
      label={translate($languageStore, "settings.reopenTutorial")}
      theme="gold"
      onClick={onOpenTutorial} />
  </section>

  <section class="about-section">
    <h2>{translate($languageStore, "about.whatsNewTitle")}</h2>
    <p>{translate($languageStore, "about.whatsNewDescription")}</p>
    <Button
      label={translate($languageStore, "about.whatsNewButton")}
      theme="gold"
      onClick={onOpenWhatsNew} />
  </section>

  <section class="about-section">
    <h2>{translate($languageStore, "about.feedbackTitle")}</h2>
    <p>{translate($languageStore, "about.feedbackDescription")}</p>
    <Button
      label={translate($languageStore, "about.feedbackButton")}
      theme="gold"
      onClick={() => (feedbackOpen = true)} />
  </section>

  <footer class="about-footer">
    <p class="about-footer__credit">
      <a class="about-link" href="https://github.com/KroxiLabs/Kroxitrade" target="_blank" rel="noreferrer">
        <img class="about-link__icon" src="https://cdn.simpleicons.org/github/f0e0bf" alt="" aria-hidden="true" />
        <span>{translate($languageStore, "about.github")}</span>
        <strong>Poe Trade Plus · KroxiLabs</strong>
      </a>
    </p>
    <p class="about-footer__support">
      <a class="about-link" href="https://github.com/MooHuiDev/poe-zh-trade-tools-pro" target="_blank" rel="noreferrer">
        <img class="about-link__icon" src="https://cdn.simpleicons.org/github/f0e0bf" alt="" aria-hidden="true" />
        <span>{translate($languageStore, "about.maintainer")}</span>
        <strong>MooHui Dev</strong>
      </a>
    </p>
    <p class="about-footer__support">
      <a class="about-link" href="https://www.patreon.com/cw/KroxiLabs" target="_blank" rel="noreferrer">
        <img class="about-link__icon" src="https://cdn.simpleicons.org/patreon/ff424d" alt="" aria-hidden="true" />
        <span>{translate($languageStore, "about.patreon")}</span>
        <strong>KroxiLabs</strong>
      </a>
    </p>
    <p class="about-footer__meta">{translate($languageStore, "about.version", { version })}</p>
    {#if dataVersion}
      <p class="about-footer__meta">{translate($languageStore, "about.dataVersion")} {dataVersion}</p>
    {/if}
  </footer>
</section>

<svelte:window onkeydown={handleWindowKeydown} />

{#if feedbackOpen}
  <div class="feedback-backdrop" role="presentation" onclick={handleFeedbackBackdrop}>
    <div class="feedback-dialog" role="dialog" aria-modal="true" aria-labelledby="feedback-dialog-title">
      <div class="feedback-dialog__header">
        <h3 id="feedback-dialog-title">{translate($languageStore, "about.feedbackDialogTitle")}</h3>
        <button
          type="button"
          class="feedback-dialog__close"
          aria-label={translate($languageStore, "about.feedbackClose")}
          title={translate($languageStore, "about.feedbackClose")}
          onclick={closeFeedback}>
          <SvgIcon svg={closeIcon} size={14} className="toolbar-svg" />
        </button>
      </div>
      <div class="feedback-dialog__body">
        {#each FEEDBACK_LINKS as link (link.key)}
          <a class="feedback-link" href={link.href} target="_blank" rel="noopener noreferrer" onclick={closeFeedback}>
            <span class="feedback-link__icon">
              {#if link.img}
                <img src={link.img} alt="" aria-hidden="true" />
              {:else}
                <SvgIcon svg={link.svg} size={16} className="toolbar-svg" />
              {/if}
            </span>
            <span class="feedback-link__text">
              <strong>{feedbackLabel(link.key)}</strong>
              <small>{feedbackHint(link.key)}</small>
            </span>
            <span class="feedback-link__go" aria-hidden="true">
              <SvgIcon svg={externalIcon} size={12} className="toolbar-svg" />
            </span>
          </a>
        {/each}
      </div>
    </div>
  </div>
{/if}

<style>
  .about-page {
    display: flex;
    flex-direction: column;
    gap: 14px;
    min-height: 100%;
    color: #d8c7a7;
  }

  .hero {
    border: 1px solid rgba(168, 129, 73, 0.24);
    background: linear-gradient(180deg, rgba(17, 16, 14, 0.96), rgba(9, 9, 8, 0.96));
    box-shadow: inset 0 1px 0 rgba(255, 226, 178, 0.04);
  }

  .hero {
    padding: 16px;
  }

  .eyebrow {
    margin-bottom: 6px;
    color: #b88a47;
    font-size: calc(10px * var(--bt-text-scale, 1));
    letter-spacing: 0.22em;
    text-transform: uppercase;
  }

  h1 {
    margin: 0;
    color: #f1dfbe;
    font-weight: 700;
  }

  h1 {
    font-size: calc(20px * var(--bt-text-scale, 1));
  }

  p {
    margin: 8px 0 0;
    color: #cbb694;
    font-size: calc(11px * var(--bt-text-scale, 1));
    line-height: 1.55;
  }

  .about-footer {
    margin-top: auto;
    padding: 4px 4px 0;
  }

  .about-footer__credit,
  .about-footer__support,
  .about-footer__meta {
    margin-top: 0;
    font-size: calc(11px * var(--bt-text-scale, 1));
    line-height: 1.45;
    color: rgba(203, 182, 148, 0.58);
  }

  .about-section {
    border: 1px solid rgba(168, 129, 73, 0.18);
    background: rgba(255, 255, 255, 0.025);
    padding: 14px;
  }

  h2 {
    margin: 0;
    color: #f1dfbe;
    font-size: calc(15px * var(--bt-text-scale, 1));
  }

  .about-section :global(.button) {
    margin-top: 12px;
  }

  .about-link {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    color: rgba(240, 224, 191, 0.82);
    text-decoration: none;
  }

  .about-link strong {
    font-weight: 700;
  }

  .about-link__icon {
    width: 13px;
    height: 13px;
    flex: 0 0 auto;
    display: block;
  }

  .about-link:hover,
  .about-link:focus-visible {
    color: #f0e0bf;
    text-decoration: underline;
    outline: none;
  }

  .about-footer__meta {
    margin-top: 4px;
    color: rgba(203, 182, 148, 0.44);
  }

  /* Feedback dialog — same frame / colours as ConfirmDialog. */
  .feedback-backdrop {
    position: fixed;
    inset: 0;
    z-index: 2147483647;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 16px;
    background: rgba(5, 5, 5, 0.72);
    backdrop-filter: blur(6px);
    overscroll-behavior: contain;
  }

  .feedback-dialog {
    width: min(100%, 360px);
    border: 1px solid rgba(163, 141, 109, 0.22);
    border-radius: 8px;
    background: linear-gradient(180deg, rgba(163, 141, 109, 0.05), rgba(163, 141, 109, 0.015)), rgba(5, 5, 5, 0.98);
    box-shadow: inset 0 1px 0 rgba(238, 238, 238, 0.02), 0 18px 38px rgba(5, 5, 5, 0.55);
    overflow: hidden;
  }

  .feedback-dialog__header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 12px 12px 10px 16px;
    border-bottom: 1px solid rgba(163, 141, 109, 0.1);
  }

  .feedback-dialog__header h3 {
    margin: 0;
    font-family: "FontinSmallcaps", serif;
    font-size: calc(15px * var(--bt-text-scale, 1));
    letter-spacing: 0.04em;
    color: #a38d6d;
  }

  .feedback-dialog__close {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 26px;
    height: 26px;
    padding: 0;
    border: 1px solid transparent;
    border-radius: 4px;
    background: transparent;
    color: rgba(203, 182, 148, 0.7);
    cursor: pointer;
  }

  .feedback-dialog__close:hover,
  .feedback-dialog__close:focus-visible {
    border-color: rgba(163, 141, 109, 0.4);
    background: rgba(163, 141, 109, 0.08);
    color: #f0e0bf;
    outline: none;
  }

  .feedback-dialog__body {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 14px 16px 16px;
  }

  .feedback-link {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 12px;
    border: 1px solid rgba(163, 141, 109, 0.4);
    background: rgba(163, 141, 109, 0.08);
    color: #a38d6d;
    text-decoration: none;
    transition: background 0.15s, border-color 0.15s, box-shadow 0.15s;
  }

  .feedback-link:hover,
  .feedback-link:focus-visible {
    background: rgba(163, 141, 109, 0.15);
    border-color: #a38d6d;
    box-shadow: 0 0 8px rgba(163, 141, 109, 0.2);
    outline: none;
  }

  .feedback-link__icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex: 0 0 auto;
    width: 18px;
    height: 18px;
    color: #f0e0bf;
  }

  .feedback-link__icon img {
    width: 16px;
    height: 16px;
    display: block;
  }

  .feedback-link__text {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
    flex: 1 1 auto;
  }

  .feedback-link__text strong {
    color: #f1dfbe;
    font-size: calc(12px * var(--bt-text-scale, 1));
    font-weight: 700;
  }

  .feedback-link__text small {
    color: rgba(203, 182, 148, 0.7);
    font-size: calc(10.5px * var(--bt-text-scale, 1));
    line-height: 1.4;
  }

  .feedback-link__go {
    display: inline-flex;
    flex: 0 0 auto;
    color: rgba(203, 182, 148, 0.55);
  }

  .feedback-link:hover .feedback-link__go {
    color: #f0e0bf;
  }
</style>
