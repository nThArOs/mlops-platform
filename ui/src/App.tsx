import { Navigate, Route, Routes } from "react-router-dom";
import Layout from "./components/Layout";
import DatasetsPage from "./pages/Datasets";
import DatasetPage from "./pages/Dataset";
import Upcoming from "./pages/Upcoming";

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Navigate to="/datasets" replace />} />
        <Route path="datasets" element={<DatasetsPage />} />
        <Route path="datasets/:name" element={<DatasetPage />} />
        <Route path="datasets/:name/v/:version" element={<DatasetPage />} />
        <Route path="models" element={<Upcoming title="Models" />} />
        <Route path="production" element={<Upcoming title="Production" />} />
        <Route path="*" element={<Upcoming title="Not found" />} />
      </Route>
    </Routes>
  );
}
