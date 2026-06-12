import { createBrowserRouter, Navigate } from "react-router-dom";
import { AppShell } from "./app-shell";
import { ExploreScreen } from "../features/explore/ExploreScreen";
import { IndexDetailScreen } from "../features/index-detail/IndexDetailScreen";
import { PortfolioRoute } from "../features/portfolio/PortfolioScreen";
import { ActivityRoute } from "../features/activity/ActivityScreen";
import { CreateWizard } from "../features/create/CreateWizard";
import { ErrorState } from "../components/ErrorState";

export const router = createBrowserRouter([
  {
    path: "/",
    element: <AppShell />,
    errorElement: <ErrorState message="Page not found" />,
    children: [
      { index: true, element: <Navigate to="/explore" replace /> },
      { path: "explore", element: <ExploreScreen /> },
      { path: "index/:vaultAddress", element: <IndexDetailScreen /> },
      { path: "portfolio", element: <PortfolioRoute /> },
      { path: "activity", element: <ActivityRoute /> },
      { path: "create", element: <CreateWizard /> },
      { path: "*", element: <ErrorState message="Page not found" /> },
    ],
  },
]);
