import React from "react";
import ReactDOM from "react-dom/client";
import { RouterProvider, createRouter } from '@tanstack/react-router'
import { AuthProvider, useAuth } from "./hooks/use-auth";
import { LoginForm } from "./components/login-form";
import { ThemeProvider } from "./components/theme-provider";
import { routeTree } from './routeTree.gen'
import "./App.css";

// Create a new router instance
const router = createRouter({
  routeTree,
  defaultPreload: 'intent',
})

// Register the router for type safety
declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}

function AuthGuard() {
  const auth = useAuth();

  if (auth.loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto"></div>
          <p className="mt-4 text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  if (!auth.isAuthenticated) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="w-full max-w-md">
          <LoginForm />
        </div>
      </div>
    );
  }

  return <RouterProvider router={router} />;
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ThemeProvider defaultTheme="dark" storageKey="coreagent-ui-theme">
      <AuthProvider>
        <AuthGuard />
      </AuthProvider>
    </ThemeProvider>
  </React.StrictMode>,
);
