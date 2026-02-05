import { useState } from "react";
import reactLogo from "./assets/react.svg";
import { invoke } from "@tauri-apps/api/core";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/hooks/use-auth";
import "./App.css";

function App() {
  const [greetMsg, setGreetMsg] = useState("");
  const [name, setName] = useState("");
  const { user, signOut } = useAuth();

  async function greet() {
    // Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
    setGreetMsg(await invoke("greet", { name }));
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="flex justify-between items-start mb-2">
            <div className="flex-1">
              <CardTitle className="text-2xl font-bold">Welcome to CoreAgent</CardTitle>
              {user && (
                <CardDescription className="mt-1">
                  Signed in as {user.email}
                </CardDescription>
              )}
            </div>
            <Button variant="outline" size="sm" onClick={() => signOut()}>
              Sign Out
            </Button>
          </div>
          <CardDescription>
            Click on the logos below to learn more about our tech stack
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-6">
          <div className="flex justify-center gap-4">
            <a href="https://vite.dev" target="_blank" rel="noopener noreferrer">
              <img
                src="/vite.svg"
                className="h-12 w-12 transition-transform hover:scale-110"
                alt="Vite logo"
              />
            </a>
            <a href="https://tauri.app" target="_blank" rel="noopener noreferrer">
              <img
                src="/tauri.svg"
                className="h-12 w-12 transition-transform hover:scale-110"
                alt="Tauri logo"
              />
            </a>
            <a href="https://react.dev" target="_blank" rel="noopener noreferrer">
              <img
                src={reactLogo}
                className="h-12 w-12 transition-transform hover:scale-110"
                alt="React logo"
              />
            </a>
          </div>

          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              greet();
            }}
          >
            <div className="space-y-2">
              <Input
                id="greet-input"
                value={name}
                onChange={(e) => setName(e.currentTarget.value)}
                placeholder="Enter your name..."
                className="w-full"
              />
            </div>
            <Button type="submit" className="w-full">
              Greet
            </Button>
          </form>

          {greetMsg && (
            <div className="p-4 bg-muted rounded-lg">
              <p className="text-sm text-muted-foreground">{greetMsg}</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default App;
