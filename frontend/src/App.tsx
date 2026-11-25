import { Routes, Route, useLocation } from "react-router-dom";
import Nav from "./components/Nav";
import ErrorBoundary from "./components/ErrorBoundary";
import Footer from "./components/Footer";
import Home from "./pages/Home";
import ContractsPage from "./pages/ContractsPage";
import ContractPage from "./pages/ContractPage";
import WalletPage from "./pages/WalletPage";
import EventPage from "./pages/EventPage";
import BettingPage from "./pages/BettingPage";
import SettingsPage from "./pages/SettingsPage";
import ReferralsPage from "./pages/ReferralsPage";
import ProfilePage from "./pages/ProfilePage";
import NotFound from "./pages/NotFound";

export default function App() {
  const location = useLocation();

  return (
    <div className="app">
      <Nav />
      <ErrorBoundary resetKey={location.pathname}>
        <main style={{ maxWidth: 1100, margin: "0 auto", padding: "24px 16px" }}>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/contracts" element={<ContractsPage />} />
            <Route path="/contract/:id" element={<ContractPage />} />
            <Route path="/wallet/:address" element={<WalletPage />} />
            <Route path="/event/:seq" element={<EventPage />} />
            <Route path="/bet" element={<BettingPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/referrals" element={<ReferralsPage />} />
            <Route path="/profile" element={<ProfilePage />} />
            <Route path="/profile/:address" element={<ProfilePage />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </main>
      </ErrorBoundary>
      <Footer />
    </div>
  );
}
