import { Routes, Route } from "react-router-dom";
import Swap from "./Swap";
import About from "./About";
import { useAccount } from "wagmi";

function Router() {
    const { address, isConnected } = useAccount();
    return (
        <Routes>
            <Route path="/" element={<Swap isConnected={isConnected} address={address} />} />
            <Route path="/about" element={<About />} />
        </Routes>
    )
}

export default Router;
