"use client";

import { createContext, useContext, useState } from "react";

interface AdminAuthCtx {
  isAdmin: boolean;
  setIsAdmin: (v: boolean) => void;
}

const AdminAuthContext = createContext<AdminAuthCtx>({ isAdmin: false, setIsAdmin: () => {} });

export function AdminAuthProvider({ children }: { children: React.ReactNode }) {
  const [isAdmin, setIsAdmin] = useState(false);
  return (
    <AdminAuthContext.Provider value={{ isAdmin, setIsAdmin }}>
      {children}
    </AdminAuthContext.Provider>
  );
}

export function useAdminAuth() {
  return useContext(AdminAuthContext);
}
