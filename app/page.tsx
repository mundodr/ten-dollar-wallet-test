"use client";

import { useEffect, useState } from "react";

const SOL_ADDRESS = "o9mfxQnHja71MNvU81gdx4VtFaYRGxGFLKDjPJKiPYt";
const BNB_ADDRESS = "0x4244f335c42ebd82dbd1378a9cb192f582d9ad18";
const BASE_ADDRESS = BNB_ADDRESS;
const TRON_ADDRESS = "TVa6sSVC4B8fKq3S8qDLKQSaYRvhkPgRBk";
const GOAL_USD = 100;

type WalletCardProps = {
  id: "solana" | "bnb" | "base" | "tron";
  network: string;
  networkCn: string;
  address: string;
  qr: string;
  explorer: string;
  assets: string;
  accent: string;
};

function WalletCard({
  id,
  network,
  networkCn,
  address,
  qr,
  explorer,
  assets,
  accent,
}: WalletCardProps) {
  const [copied, setCopied] = useState(false);
  const networkNames = {
    solana: "Solana",
    bnb: "BNB Smart Chain (BEP-20)",
    base: "Base",
    tron: "TRON (TRC-20)",
  };

  async function copyAddress() {
    await navigator.clipboard.writeText(address);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }

  return (
    <article className="wallet-card" style={{ "--accent": accent } as React.CSSProperties}>
      <div className="wallet-card__top">
        <div>
          <span className="network-kicker">{networkCn}</span>
          <h3>{network}</h3>
        </div>
        <span className="status-dot"><i /> LIVE</span>
      </div>

      <div className="wallet-card__body">
        <div className="qr-shell">
          <img src={qr} alt={`${network} donation address QR code`} />
        </div>
        <div className="wallet-details">
          <p className="asset-line">可接收 / ACCEPTS</p>
          <p className="assets">{assets}</p>
          <p className="address-label">钱包地址 / WALLET ADDRESS</p>
          <code>{address}</code>
          <div className="wallet-actions">
            <button type="button" onClick={copyAddress} aria-live="polite">
              {copied ? "已复制 · COPIED" : "复制地址 · COPY"}
            </button>
            <a href={explorer} target="_blank" rel="noreferrer">
              链上核验 · VERIFY ↗
            </a>
          </div>
        </div>
      </div>

      <p className="network-warning">
        仅使用 {networkNames[id]} 网络发送。
        <span> Send only on the named network.</span>
      </p>
    </article>
  );
}

export default function Home() {
  const [progress, setProgress] = useState<{
    balances: {
      sol: number;
      solUsdc: number;
      bnb: number;
      bscUsdt: number;
      bscUsdc: number;
      baseEth: number;
      baseUsdc: number;
      trx: number;
      tronUsdt: number;
    };
    usdTotal: number;
    percent: number;
    updatedAt: string;
  } | null>(null);

  useEffect(() => {
    let active = true;
    fetch("/api/progress")
      .then((response) => response.ok ? response.json() : Promise.reject())
      .then((data) => { if (active) setProgress(data); })
      .catch(() => undefined);
    return () => { active = false; };
  }, []);

  const funded = progress?.usdTotal ?? 0;
  const percent = progress?.percent ?? 0;
  const remaining = Math.max(0, GOAL_USD - funded);

  return (
    <main>
      <nav className="nav shell" aria-label="Main navigation">
        <a className="wordmark" href="#top" aria-label="The hundred dollar wallet goal home">
          <span>100</span> / HUNDRED
        </a>
        <a className="ledger-link" href="#wallets">
          <i /> 公开账本 · PUBLIC LEDGER
        </a>
      </nav>

      <section className="hero shell" id="top">
        <div className="hero-copy">
          <p className="eyebrow">一个人与 AI 的公开实验 · A PERSON + AN AI</p>
          <h1>
            让四条链的小额到账
            <br />
            合计达到 <em>$100</em>
          </h1>
          <p className="lead-cn">
            这不是慈善，也没有编造困难。我们只是诚实地问：公开的小额赠与与原创工作收入，能否让 Solana、BNB Smart Chain、Base 和 TRON 上的公开地址合计达到 100 美元？
          </p>
          <p className="lead-en">
            No hardship story. No token sale. Can small gifts and original-work earnings across four public blockchain routes reach a combined $100?
          </p>
          <div className="hero-actions">
            <a className="primary-button" href="#wallets">选择网络 · CHOOSE A NETWORK ↓</a>
            <span>任意金额都有帮助 · Any amount counts</span>
          </div>
        </div>

        <aside className="target-card" aria-label="Verified wallet progress toward one hundred dollars">
          <div className="target-card__header">
            <span>目标 / TARGET</span>
            <span className="verified">链上可查 · ON-CHAIN</span>
          </div>
          <div className="amount-row">
          <strong>${funded.toFixed(2)}</strong>
            <span>/ $100.00</span>
          </div>
          <div className="progress-track" aria-hidden="true"><span style={{ width: `${Math.max(percent > 0 ? 1 : 0.2, percent)}%` }} /></div>
          <div className="progress-meta">
            <span>{percent.toFixed(1)}% FUNDED</span>
            <span>${remaining.toFixed(2)} TO GO</span>
          </div>
          <div className="starting-balances">
            <p><span>SOL</span><b>{(progress?.balances.sol ?? 0).toFixed(6)}</b></p>
            <p><span>BNB</span><b>{(progress?.balances.bnb ?? 0).toFixed(6)}</b></p>
            <p><span>BASE ETH</span><b>{(progress?.balances.baseEth ?? 0).toFixed(6)}</b></p>
            <p><span>TRX</span><b>{(progress?.balances.trx ?? 0).toFixed(6)}</b></p>
            <p><span>STABLECOINS</span><b>{(
              (progress?.balances.solUsdc ?? 0) +
              (progress?.balances.bscUsdt ?? 0) +
              (progress?.balances.bscUsdc ?? 0) +
              (progress?.balances.baseUsdc ?? 0) +
              (progress?.balances.tronUsdt ?? 0)
            ).toFixed(2)}</b></p>
          </div>
          <p className="timestamp">
            {progress ? `链上更新 · ${new Date(progress.updatedAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false })}` : "起始余额核验于 2026-08-27 17:06 CST"}
          </p>
        </aside>
      </section>

      <section className="marquee" aria-label="Campaign principles">
        <div>
          <span>NO TRAGEDY STORY</span><i>◆</i>
          <span>NO TOKEN SALE</span><i>◆</i>
          <span>NO RETURNS PROMISED</span><i>◆</i>
          <span>THE $100 WALLET GOAL</span><i>◆</i>
        </div>
      </section>

      <section className="wallets shell" id="wallets">
        <div className="section-heading">
          <div>
            <p className="eyebrow">02 / DIRECT TO WALLET</p>
            <h2>选择一条链，送出一点点。</h2>
          </div>
          <p>Choose one network. Your gift goes directly to the listed wallet—no middleman and no platform checkout.</p>
        </div>

        <div className="wallet-grid">
          <WalletCard
            id="solana"
            network="SOLANA"
            networkCn="低手续费 · LOW FEE"
            address={SOL_ADDRESS}
            qr="/solana-qr.png"
            explorer={`https://solscan.io/account/${SOL_ADDRESS}`}
            assets="SOL · USDC (SPL)"
            accent="#6bf6c7"
          />
          <WalletCard
            id="bnb"
            network="BNB SMART CHAIN"
            networkCn="BEP-20 网络 · NETWORK"
            address={BNB_ADDRESS}
            qr="/bnb-qr.png"
            explorer={`https://bscscan.com/address/${BNB_ADDRESS}`}
            assets="BNB · USDT · USDC (BEP-20)"
            accent="#f4ba2a"
          />
          <WalletCard
            id="base"
            network="BASE"
            networkCn="BASE L2 · NETWORK"
            address={BASE_ADDRESS}
            qr="/base-qr.png"
            explorer={`https://basescan.org/address/${BASE_ADDRESS}`}
            assets="ETH · USDC (BASE)"
            accent="#5b7cff"
          />
          <WalletCard
            id="tron"
            network="TRON"
            networkCn="TRC-20 网络 · NETWORK"
            address={TRON_ADDRESS}
            qr="/tron-qr.png"
            explorer={`https://tronscan.org/#/address/${TRON_ADDRESS}`}
            assets="TRX · USDT (TRC-20)"
            accent="#ff4d5f"
          />
        </div>
      </section>

      <section className="rules shell">
        <div className="rules-title">
          <p className="eyebrow">03 / THE FINE PRINT</p>
          <h2>清楚、简单、没有套路。</h2>
          <p>Clear, simple, and deliberately un-dramatic.</p>
        </div>
        <ol>
          <li><span>01</span><div><h3>完全自愿 · VOLUNTARY</h3><p>不提供商品、服务、抽奖资格或回报。No purchase, reward, raffle entry, or financial return.</p></div></li>
          <li><span>02</span><div><h3>不可逆 · FINAL</h3><p>链上转账通常无法撤回；发送前请再次核对网络和地址。Crypto transfers are generally irreversible—check twice.</p></div></li>
          <li><span>03</span><div><h3>公开可查 · VERIFIABLE</h3><p>四条链上的三个地址和起始余额公开展示，任何人都能在区块浏览器核验。All three addresses across four networks and their starting balances are public.</p></div></li>
          <li><span>04</span><div><h3>不是慈善 · NOT A CHARITY</h3><p>这是给页面创建者的个人赠与，不开具抵税凭证。This is a personal gift to the page creator, not a tax-deductible donation.</p></div></li>
        </ol>
      </section>

      <section className="closing shell">
        <p className="eyebrow">THE ASK, IN ONE LINE</p>
        <h2>如果这个诚实的小实验让你会心一笑，送一美元，或更少。</h2>
        <p>If this honest little experiment made you smile, send a dollar—or less.</p>
        <a className="primary-button" href="#wallets">查看钱包 · VIEW WALLETS ↑</a>
      </section>

      <footer className="shell">
        <span>THE $100 WALLET GOAL · 2026</span>
        <a href="https://github.com/mundodr/ten-dollar-wallet-test/issues/2" target="_blank" rel="noreferrer">
          2 USDC WORK OFFER ↗
        </a>
        <span>BUILT IN PUBLIC · 可公开核验</span>
      </footer>
    </main>
  );
}
