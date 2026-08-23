import { createBrowserRouter, RouterProvider } from "react-router";
import { Layout } from "@/components/layout";
import { AccountPage } from "@/features/account/page";
import { ContractPage } from "@/features/contract/page";
import { HomePage } from "@/features/home/page";
import { LedgerPage } from "@/features/ledger/page";
import { NotFoundPage } from "@/features/not-found";
import { TxPage } from "@/features/tx/page";

const router = createBrowserRouter([
  {
    path: "/",
    element: <Layout />,
    children: [
      { index: true, element: <HomePage /> },
      { path: "tx/:hash", element: <TxPage /> },
      { path: "account/:address", element: <AccountPage /> },
      { path: "contract/:contractId", element: <ContractPage /> },
      { path: "ledger/:sequence", element: <LedgerPage /> },
      { path: "*", element: <NotFoundPage /> },
    ],
  },
]);

export function App() {
  return <RouterProvider router={router} />;
}
