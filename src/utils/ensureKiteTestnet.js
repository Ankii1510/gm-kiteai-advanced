export async function ensureKiteTestnet() {
  if (!window.ethereum) {
    alert("MetaMask ya compatible wallet install karo.");
    return false;
  }
  const kiteChainId = "0x940"; // 2368
  try {
    await window.ethereum.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: kiteChainId }],
    });
    return true;
  } catch (switchError) {
    if (switchError.code === 4902 || /Unrecognized chain/i.test(switchError.message)) {
      try {
        await window.ethereum.request({
          method: "wallet_addEthereumChain",
          params: [{
            chainId: kiteChainId,
            chainName: "Kite AI Testnet",
            nativeCurrency: { name: "KITE", symbol: "KITE", decimals: 18 },
            rpcUrls: ["https://rpc-testnet.gokite.ai/"],
            blockExplorerUrls: ["https://testnet.kitescan.ai/"]
          }]
        });
        await window.ethereum.request({
          method: "wallet_switchEthereumChain",
          params: [{ chainId: kiteChainId }],
        });
        return true;
      } catch (addErr) {
        console.error("Add network failed", addErr);
        alert("Wallet network add karne me problem. RPC: https://rpc-testnet.gokite.ai/ , ChainId 2368");
        return false;
      }
    } else if (switchError.code === 4001) {
      alert("User denied network switch.");
      return false;
    } else {
      console.error("Switch error", switchError);
      return false;
    }
  }
}
