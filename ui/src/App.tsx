import { Navigate, Route, Routes } from "react-router-dom";
import Layout from "./components/Layout";
import DatasetsPage from "./pages/Datasets";
import DatasetPage from "./pages/Dataset";
import ModelsPage from "./pages/Models";
import ModelPage from "./pages/Model";
import { ProductionList, ProductionService } from "./pages/Production";
import { RunPage, RunsList } from "./pages/Runs";
import { SweepPage } from "./pages/Sweep";
import Upcoming from "./pages/Upcoming";

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Navigate to="/datasets" replace />} />
        <Route path="datasets" element={<DatasetsPage />} />
        <Route path="datasets/:name" element={<DatasetPage />} />
        <Route path="datasets/:name/v/:version" element={<DatasetPage />} />
        <Route path="models" element={<ModelsPage />} />
        <Route path="models/:project" element={<ModelPage />} />
        <Route path="runs" element={<RunsList />} />
        <Route path="runs/:id" element={<RunPage />} />
        <Route path="sweeps/:id" element={<SweepPage />} />
        <Route path="production" element={<ProductionList />} />
        <Route path="production/:project" element={<ProductionService />} />
        <Route path="*" element={<Upcoming title="Not found" />} />
      </Route>
    </Routes>
  );
}
