import "./App.css";
import Header from "./components/Header";
import Router from "./components/Router";
import { useConnect, useAccount } from "wagmi";
import { MetaMaskConnector } from "wagmi/connectors/metaMask";

function App() {
  const { address, isConnected } = useAccount();
  const { connect } = useConnect({
    connector: new MetaMaskConnector(),
  });
  
  return (
    <div className="App">
      <Header connect={connect} isConnected={isConnected} address={address} />
      <div className="mainWindow">
        <Router />
      </div>
    </div>
  )
}

export default App;
