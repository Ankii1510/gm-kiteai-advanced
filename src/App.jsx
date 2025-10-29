import React, { useEffect, useState, useRef } from "react";
import { ethers } from "ethers";
import ABI from "./GMSenderABI.json";
import { ensureKiteTestnet } from "./utils/ensureKiteTestnet";
import logo from './assets/kite-logo.png';

const RPC = "https://rpc-testnet.gokite.ai/";
const CONTRACT_ADDRESS = "0x8001C883738a3AC21b53A219e5C087e8f9b2a80f";
const EXPLORER_TX = "https://testnet.kitescan.ai/tx/";
const COOLDOWN_SECONDS = 24 * 60 * 60;
const MAX_EVENTS_FETCH = 3000;

const short = (addr) => (addr ? `${String(addr).slice(0,6)}...${String(addr).slice(-4)}` : "");
const nowUnix = () => Math.floor(Date.now()/1000);

function Avatar({address, size=40}) {
  const hash = address ? String(address).slice(2,8) : '000000';
  const hue = parseInt(hash,16) % 360;
  const style = { width: size, height: size, background: `linear-gradient(135deg, hsl(${hue} 65% 50%), hsl(${(hue+60)%360} 65% 40%))` };
  return <div style={style} className="rounded-full flex items-center justify-center text-white font-bold">{address ? address.slice(2,4).toUpperCase() : 'GM'}</div>;
}

export default function App() {
  const [provider, setProvider] = useState(null);
  const [signer, setSigner] = useState(null);
  const [account, setAccount] = useState(null);
  const [contractRead, setContractRead] = useState(null);
  const [contractWrite, setContractWrite] = useState(null);
  const [gms, setGms] = useState([]);
  const [globalCount, setGlobalCount] = useState(0);
  const [yourCount, setYourCount] = useState(0);
  const [lastYourTs, setLastYourTs] = useState(null);
  const [countdown, setCountdown] = useState(0);
  const [txState, setTxState] = useState(null);
  const pollRef = useRef(null);

  useEffect(() => {
    const p = new ethers.JsonRpcProvider(RPC);
    setProvider(p);
    const c = new ethers.Contract(CONTRACT_ADDRESS, ABI, p);
    setContractRead(c);
  }, []);

  useEffect(() => {
    if (!contractRead) return;
    let canceled = false;
    (async () => {
      try {
        const filter = contractRead.filters.GMSent();
        const events = await contractRead.queryFilter(filter, 0, "latest");
        const sliced = events.slice(-MAX_EVENTS_FETCH);
        const parsed = sliced.map(e => ({ sender: e.args.sender, message: e.args.message, timestamp: Number(e.args.timestamp), txHash: e.transactionHash })).reverse();
        if (!canceled) {
          setGms(parsed);
          setGlobalCount(parsed.length);
        }
      } catch (err) {
        console.error(err);
      }
    })();
    return () => { canceled = true; };
  }, [contractRead]);

  const computeUserStats = (addr, eventsArr) => {
    if (!addr || !eventsArr) return;
    const a = String(addr).toLowerCase();
    let cnt = 0;
    let lastTs = null;
    for (const e of eventsArr) {
      if (String(e.sender).toLowerCase() === a) {
        cnt++;
        if (!lastTs || e.timestamp > lastTs) lastTs = e.timestamp;
      }
    }
    setYourCount(cnt);
    setLastYourTs(lastTs);
  };

  useEffect(() => {
    setGlobalCount(gms.length);
    if (account) computeUserStats(account, gms);
  }, [gms]);

  useEffect(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(() => {
      let timeLeft = 0;
      if (lastYourTs) {
        const nextAllowed = lastYourTs + COOLDOWN_SECONDS;
        timeLeft = Math.max(0, nextAllowed - nowUnix());
      }
      setCountdown(timeLeft);
    }, 1000);
    return () => clearInterval(pollRef.current);
  }, [lastYourTs]);

  const connectWallet = async () => {
    if (!window.ethereum) return alert("Please install MetaMask or compatible wallet.");
    const ok = await ensureKiteTestnet();
    if (!ok) return;
    try {
      await window.ethereum.request({ method: "eth_requestAccounts" });
      const wp = new ethers.BrowserProvider(window.ethereum);
      const s = await wp.getSigner();
      const addr = await s.getAddress();
      setSigner(s);
      setAccount(addr);
      const cw = new ethers.Contract(CONTRACT_ADDRESS, ABI, s);
      setContractWrite(cw);
      computeUserStats(addr, gms);

      cw.on("GMSent", (sender, message, timestamp, event) => {
        const obj = { sender, message, timestamp: Number(timestamp), txHash: event.transactionHash };
        setGms(prev => [obj, ...prev].slice(0, MAX_EVENTS_FETCH));
        setGlobalCount(c => c + 1);
        if (String(sender).toLowerCase() === String(addr).toLowerCase()) {
          setYourCount(c => c + 1);
          setLastYourTs(Number(timestamp));
        }
      });

      window.ethereum.on("accountsChanged", () => window.location.reload());
      window.ethereum.on("chainChanged", () => window.location.reload());
    } catch (err) {
      console.error(err);
    }
  };

  const sendGM = async () => {
    if (!contractWrite || !account) return alert("Connect wallet first.");
    if (lastYourTs) {
      const nextAllowed = lastYourTs + COOLDOWN_SECONDS;
      if (nowUnix() < nextAllowed) return alert("You are on cooldown.");
    }
    const ok = await ensureKiteTestnet();
    if (!ok) return;
    try {
      setTxState({ stage: "sending" });
      const tx = await contractWrite.sendGM("");
      setTxState({ stage: "pending", hash: tx.hash });
      await tx.wait();
      setTxState({ stage: "confirmed", hash: tx.hash });
      setYourCount(c => c + 1);
      setLastYourTs(nowUnix());
      setTimeout(() => setTxState(null), 6000);
    } catch (err) {
      console.error(err);
      setTxState({ stage: "failed", err: err && err.message ? err.message : String(err) });
      setTimeout(() => setTxState(null), 8000);
    }
  };

  const formatCountdown = s => {
    if (!s) return "0s";
    const h = Math.floor(s/3600);
    const m = Math.floor((s%3600)/60);
    const sec = s%60;
    if (h>0) return `${h}h ${m}m ${sec}s`;
    if (m>0) return `${m}m ${sec}s`;
    return `${sec}s`;
  };

  const nextLabel = account ? (countdown>0 ? `NEXT GM IN ${formatCountdown(countdown)}` : "YOU CAN GM NOW!") : "Connect wallet to GM";

  return (
    <div className="min-h-screen flex flex-col bg-gradient-hero text-slate-100">
      <div className="px-6 py-4 flex justify-between items-start">
        <div className="space-y-1">
          <div className="text-sm text-slate-300">Global GM Count: <span className="font-semibold text-white">{globalCount.toLocaleString()}</span></div>
          <div className="text-sm text-slate-400">Your GMs: <span className="font-semibold text-white">{yourCount}</span></div>
        </div>

        <div className="flex items-center gap-4">
          <div className="text-sm text-slate-300">Built on Kite AI Testnet</div>
          <div>
            {account ? (
              <div className="flex items-center gap-3">
                <Avatar address={account} size={44} />
                <div className="text-sm text-slate-200 font-mono">{short(account)}</div>
              </div>
            ) : (
              <button onClick={connectWallet} className="bg-cyan-400 text-slate-900 px-4 py-2 rounded-lg font-semibold shadow-xl">Connect Wallet</button>
            )}
          </div>
        </div>
      </div>

      <div className="flex-1 flex items-center justify-center">
        <div className="text-center">
          <div className="flex items-center justify-center gap-4 mb-4">
            <img src={logo} alt="kite" className="w-16 h-16 animate-pulse-slow drop-shadow-lg" />
            <h1 className="text-6xl md:text-8xl font-extrabold glow-heading">GM</h1>
          </div>
          <div className="text-sm text-slate-300 mb-6">powered by Kite AI Testnet</div>

          <div className="mb-8">
            <div className="text-3xl md:text-4xl font-semibold">{nextLabel}</div>
          </div>

          <div className="flex justify-center gap-4">
            <button onClick={sendGM} disabled={!account || countdown>0 || (txState && txState.stage==='pending')} className={`px-6 py-3 rounded-full text-lg font-semibold shadow-2xl transition ${!account ? 'bg-slate-600 cursor-not-allowed' : countdown>0 ? 'bg-amber-600/60 cursor-not-allowed' : 'bg-cyan-400 text-slate-900 hover:scale-105'}`}>
              {txState && txState.stage==='pending' ? 'Sending...' : 'Send GM'}
            </button>
            <button onClick={() => { if(!account) return alert('Connect wallet first.'); navigator.clipboard.writeText(window.location.href + '?ref=' + account); alert('Referral link copied'); }} className="px-5 py-3 rounded-full bg-slate-700/50">Share</button>
          </div>

          {txState && txState.stage==='pending' && <div className="mt-4 text-sm text-slate-300">Pending — <a className="underline" href={EXPLORER_TX + txState.hash} target="_blank" rel="noreferrer">view on explorer</a></div>}
        </div>
      </div>

      <div className="px-6 py-4 flex justify-between items-center">
        <div className="text-sm text-slate-400">Your address: <span className="font-mono">{account ? account : 'Not connected'}</span></div>
        <div><a className="text-sm text-amber-400 font-semibold" href="https://testnet.kitescan.ai" target="_blank" rel="noreferrer">View on KiteScan</a></div>
      </div>

      <div className="fixed right-6 bottom-24 w-80 max-h-[60vh] overflow-auto p-3 bg-slate-900/60 rounded-xl border border-slate-700">
        <div className="text-sm text-slate-300 mb-2 font-semibold">Recent GMs</div>
        <ul className="space-y-2">
          {gms.slice(0,12).map((g,i) => (
            <li key={i} className="flex items-start gap-3 text-sm">
              <div className="flex-none"><Avatar address={g.sender} size={36} /></div>
              <div className="flex-1">
                <div className="font-mono text-xs">{short(g.sender)}</div>
                <div className="mt-1 text-slate-100">{g.message || 'GM'}</div>
                <div className="text-xs text-slate-400 mt-1">{new Date(g.timestamp*1000).toLocaleString()}</div>
              </div>
              <div className="flex-none text-xs text-slate-400"><a className="underline" href={EXPLORER_TX + g.txHash} target="_blank" rel="noreferrer">tx</a></div>
            </li>
          ))}
        </ul>
      </div>

      {txState && txState.stage==='failed' && <div className="fixed left-1/2 -translate-x-1/2 bottom-6 bg-rose-600 text-white px-4 py-2 rounded-md shadow-lg">Error: {txState.err}</div>}
    </div>
  );
}
