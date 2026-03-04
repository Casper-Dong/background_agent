import { Routes, Route } from "react-router-dom";
import { Layout } from "./components/Layout";
import { Dashboard } from "./pages/Dashboard";
import { JobDetail } from "./pages/JobDetail";

export function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/jobs/:id" element={<JobDetail />} />
      </Routes>
    </Layout>
  );
}
