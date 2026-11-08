"use client";

import { AnimatePresence, motion } from "framer-motion";
import {
  Activity, ArrowUp, AudioLines, Bot, Check, ChevronDown,
  Command, ExternalLink, FolderOpen, Gauge, Globe2, Headphones,
  History, KeyRound, LayoutDashboard, LoaderCircle, LockKeyhole, Menu,
  Mic, MicOff, MoreHorizontal, Plus, Radio, Settings2, Shield,
  ShieldAlert, Sparkles, Square, Trash2, Volume2, X, Zap,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { FormEvent, KeyboardEvent, useCallback, useEffect, useRef, useState } from "react";

const API = process.env.NEXT_PUBLIC_API_URL?.replace(/\/+$/, "") ||
  (typeof window !== "undefined" && ["localhost", "127.0.0.1"].includes(window.location.hostname)
    ? "http://127.0.0.1:8000"
    : "");

function getApiBaseUrl(): string {
  if (!API) {
    throw new Error("MiMu's backend is not configured for this site. Set NEXT_PUBLIC_API_URL in Netlify and redeploy.");
  }
  return API;
}

type View = "chat" | "memory" | "skills" | "settings";
type VoiceState = "idle" | "listening" | "thinking" | "speaking";
type Message = { role: "user" | "assistant"; content: string; created_at?: string };
type Conversation = { id: string; title: string; updated_at: string; message_count: number };
type Memory = { id: number; content: string; created_at: string };
type ActionLog = { id: number; action: string; target: string; status: string; created_at: string };
type Skill = { id: string; name: string; description: string; available: boolean };
type Settings = {
  ai_provider: string;
  ai_configured: boolean;
  voice_configured: boolean;
  text_model: string;
  realtime_model: string;
  voice: string;
  automation_enabled: boolean;
  platform: string;
  api_key_source: string;
};
type PendingAction = {
  action_type: "app" | "website";
  target: string;
  label: string;
  sourceText?: string;
  conversationId?: string;
};
type BrowserSpeechResult = ArrayLike<{ transcript: string }> & { isFinal: boolean };
type BrowserSpeechEvent = Event & {
  resultIndex: number;
  results: ArrayLike<BrowserSpeechResult>;
};
type BrowserSpeechErrorEvent = Event & { error: string };
type BrowserSpeechRecognition = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: BrowserSpeechEvent) => void) | null;
  onerror: ((event: BrowserSpeechErrorEvent) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};

declare global {
  interface Window {
    SpeechRecognition?: new () => BrowserSpeechRecognition;
    webkitSpeechRecognition?: new () => BrowserSpeechRecognition;
  }
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${getApiBaseUrl()}${path}`, {
      ...init,
      headers: { "Content-Type": "application/json", ...init?.headers },
    });
  } catch {
    throw new Error("MiMu's backend is unreachable. Check the backend service and try again.");
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(typeof data.detail === "string" ? data.detail : `Request failed (${response.status}).`);
  }
  return data as T;
}

async function streamChatReply(
  conversationId: string,
  message: string,
  onDelta: (content: string) => void,
): Promise<void> {
  let response: Response;
  try {
    response = await fetch(`${getApiBaseUrl()}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ conversation_id: conversationId, message }),
    });
  } catch {
    throw new Error("MiMu's backend is unreachable. Check the backend service and try again.");
  }
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(typeof data.detail === "string" ? data.detail : `Request failed (${response.status}).`);
  }
  if (!response.body) throw new Error("The AI stream did not provide a response body.");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let completed = false;
  const consumeFrame = (frame: string) => {
    const dataLine = frame.split(/\r?\n/).find((line) => line.startsWith("data:"));
    if (!dataLine) return;
    let event: { type?: string; content?: string; detail?: string };
    try {
      event = JSON.parse(dataLine.slice(5).trim()) as typeof event;
    } catch {
      throw new Error("MiMu received an unreadable response from the AI provider.");
    }
    if (event.type === "delta" && typeof event.content === "string") onDelta(event.content);
    if (event.type === "error") throw new Error(event.detail || "The AI provider could not complete this response.");
    if (event.type === "done") completed = true;
  };

  try {
    while (!completed) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      const frames = buffer.split(/\r?\n\r?\n/);
      buffer = frames.pop() ?? "";
      for (const frame of frames) {
        consumeFrame(frame);
        if (completed) break;
      }
      if (done) {
        if (buffer.trim()) consumeFrame(buffer);
        buffer = "";
        break;
      }
    }
  } catch (error) {
    await reader.cancel();
    throw error;
  }
  if (!completed) throw new Error("The AI response ended before it was complete. Please try again.");
}

function parseAutomationIntent(text: string): Omit<PendingAction, "sourceText" | "conversationId"> | null {
  const command = text.trim().replace(/^mimu[,:\s]+/i, "").replace(/[.!?]+$/, "");
  const match = command.match(/^open\s+(?:the\s+)?(.+?)(?:\s+please)?$/i);
  if (!match) return null;
  const target = match[1].trim();
  const appNames: Record<string, string> = {
    "vs code": "Visual Studio Code",
    "visual studio code": "Visual Studio Code",
    terminal: "Terminal",
    chrome: "Google Chrome",
    "google chrome": "Google Chrome",
    finder: "Finder",
    "system settings": "System Settings",
  };
  const app = appNames[target.toLowerCase()];
  if (app) return { action_type: "app", target: app, label: `Open ${app}` };

  const hasProtocol = /^https?:\/\//i.test(target);
  if (!hasProtocol && !/^(?:www\.)?[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9-]+)+(?:\:\d+)?(?:[/?#]\S*)?$/i.test(target)) {
    return null;
  }
  try {
    const url = new URL(hasProtocol ? target : `https://${target}`);
    if (!["http:", "https:"].includes(url.protocol) || !url.hostname || url.username || url.password) return null;
    return { action_type: "website", target: url.href, label: `Open website ${url.href}` };
  } catch {
    return null;
  }
}

const initials = (role: Message["role"]) => role === "assistant" ? "M" : "Y";

export default function Home() {
  const [view, setView] = useState<View>("chat");
  const [mobileSidebar, setMobileSidebar] = useState(false);
  const [backendOnline, setBackendOnline] = useState(false);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [memories, setMemories] = useState<Memory[]>([]);
  const [actions, setActions] = useState<ActionLog[]>([]);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [input, setInput] = useState("");
  const [memoryInput, setMemoryInput] = useState("");
  const [websiteInput, setWebsiteInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [voiceState, setVoiceState] = useState<VoiceState>("idle");
  const [voiceActive, setVoiceActive] = useState(false);
  const [browserVoiceActive, setBrowserVoiceActive] = useState(false);
  const [muted, setMuted] = useState(false);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [actionRunning, setActionRunning] = useState(false);
  const [actionMessage, setActionMessage] = useState("");
  const [automationBusy, setAutomationBusy] = useState(false);
  const [showKeyHelp, setShowKeyHelp] = useState(false);
  const [diagnostics, setDiagnostics] = useState<Record<string, string> | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const peerRef = useRef<RTCPeerConnection | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const dataChannelRef = useRef<RTCDataChannel | null>(null);
  const voiceConversationRef = useRef<string | null>(null);
  const recognitionRef = useRef<BrowserSpeechRecognition | null>(null);
  const browserVoiceRef = useRef(false);
  const browserVoiceProcessingRef = useRef(false);
  const recognitionRestartTimerRef = useRef<number | null>(null);

  const refreshBackend = useCallback(async () => {
    try {
      await api("/api/health");
      const [currentSettings, history, status] = await Promise.all([
        api<Settings>("/api/settings"),
        api<Conversation[]>("/api/conversations"),
        api<Record<string, string>>("/api/diagnostics"),
      ]);
      setBackendOnline(true);
      setSettings(currentSettings);
      setConversations(history);
      setDiagnostics(status);
    } catch {
      setBackendOnline(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => { void refreshBackend(); }, 0);
    return () => window.clearTimeout(timer);
  }, [refreshBackend]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, loading]);

  useEffect(() => {
    if (view === "memory" && backendOnline) {
      void api<Memory[]>("/api/memories").then(setMemories).catch((err: Error) => setError(err.message));
    }
    if (view === "skills" && backendOnline) {
      void api<Skill[]>("/api/skills").then(setSkills).catch((err: Error) => setError(err.message));
    }
    if (view === "settings" && backendOnline) {
      void api<Record<string, string>>("/api/diagnostics").then(setDiagnostics).catch((err: Error) => setError(err.message));
      void api<ActionLog[]>("/api/actions").then(setActions).catch((err: Error) => setError(err.message));
    }
  }, [view, backendOnline]);

  const startNewConversation = () => {
    stopVoice();
    setConversationId(null);
    setMessages([]);
    setInput("");
    setError("");
    setView("chat");
    setMobileSidebar(false);
  };

  const openConversation = async (id: string) => {
    setError("");
    try {
      const data = await api<{ messages: Message[] }>(`/api/conversations/${encodeURIComponent(id)}`);
      setConversationId(id);
      setMessages(data.messages);
      setView("chat");
      setMobileSidebar(false);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const deleteConversation = async (id: string) => {
    try {
      await api(`/api/conversations/${encodeURIComponent(id)}`, { method: "DELETE" });
      setConversations((items) => items.filter((item) => item.id !== id));
      if (conversationId === id) {
        setConversationId(null);
        setMessages([]);
      }
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const sendMessage = async (text = input) => {
    const trimmed = text.trim();
    if (!trimmed || loading) return;
    if (!backendOnline) {
      setError("MiMu's backend is offline. Start the FastAPI server to continue.");
      return;
    }
    const automationIntent = parseAutomationIntent(trimmed);
    if (automationIntent) {
      if (!settings?.automation_enabled) {
        setError("Mac automation is disabled. Enable it in Settings before asking MiMu to open apps or websites. Nothing was run.");
        setView("settings");
        return;
      }
      const id = conversationId ?? crypto.randomUUID();
      if (!conversationId) setConversationId(id);
      setError("");
      setPendingAction({ ...automationIntent, sourceText: trimmed, conversationId: id });
      return;
    }
    if (!settings?.ai_configured) {
      const keyName = settings?.ai_provider === "gemini" ? "GEMINI_API_KEY" : "OPENAI_API_KEY";
      setError(`AI is not configured yet. Add ${keyName} to the backend environment, then restart the backend.`);
      setView("settings");
      return;
    }
    const id = conversationId ?? crypto.randomUUID();
    if (!conversationId) setConversationId(id);
    setInput("");
    setError("");
    setMessages((items) => [...items, { role: "user", content: trimmed }]);
    setMessages((items) => [...items, { role: "assistant", content: "" }]);
    setLoading(true);
    try {
      await streamChatReply(id, trimmed, (delta) => {
        setMessages((items) => {
          const last = items[items.length - 1];
          if (last?.role === "assistant") {
            return [...items.slice(0, -1), { ...last, content: last.content + delta }];
          }
          return [...items, { role: "assistant", content: delta }];
        });
      });
      setConversations(await api<Conversation[]>("/api/conversations"));
    } catch (err) {
      setError((err as Error).message);
      setMessages((items) => {
        const last = items[items.length - 1];
        return last?.role === "assistant" && !last.content ? items.slice(0, -1) : items;
      });
    } finally {
      setLoading(false);
    }
  };

  const handleComposerKey = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void sendMessage();
    }
  };

  const appendVoiceMessage = (role: Message["role"], content: string) => {
    const transcript = content.trim();
    if (!transcript) return;
    setMessages((items) => [...items, { role, content: transcript }]);
    const id = voiceConversationRef.current;
    if (id) {
      void api("/api/voice/transcript", {
        method: "POST",
        body: JSON.stringify({ conversation_id: id, role, content: transcript }),
      }).then(() => api<Conversation[]>("/api/conversations").then(setConversations))
        .catch((err: Error) => setError(`Voice transcript could not be saved: ${err.message}`));
    }
  };

  const stopVoice = useCallback(() => {
    browserVoiceRef.current = false;
    browserVoiceProcessingRef.current = false;
    if (recognitionRestartTimerRef.current !== null) {
      window.clearTimeout(recognitionRestartTimerRef.current);
      recognitionRestartTimerRef.current = null;
    }
    recognitionRef.current?.abort();
    recognitionRef.current = null;
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    dataChannelRef.current?.close();
    dataChannelRef.current = null;
    peerRef.current?.close();
    peerRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (audioRef.current) audioRef.current.srcObject = null;
    voiceConversationRef.current = null;
    setVoiceActive(false);
    setBrowserVoiceActive(false);
    setVoiceState("idle");
    setMuted(false);
  }, []);

  const startBrowserVoice = () => {
    const Recognition = window.SpeechRecognition ?? window.webkitSpeechRecognition;
    if (!Recognition || !("speechSynthesis" in window)) {
      setError("Free browser voice needs Chrome with microphone and speech features enabled. Try the latest Google Chrome over HTTPS.");
      return;
    }
    if (!settings?.ai_configured || !backendOnline) {
      setError("Connect MiMu to the backend and configure its AI provider before starting voice.");
      return;
    }

    setError("");
    try {
      const recognition = new Recognition();
      recognition.continuous = true;
      recognition.interimResults = false;
      recognition.lang = "bn-BD";
      recognitionRef.current = recognition;
      browserVoiceRef.current = true;
      browserVoiceProcessingRef.current = false;
      const id = conversationId ?? crypto.randomUUID();
      voiceConversationRef.current = id;
      if (!conversationId) setConversationId(id);
      setBrowserVoiceActive(true);
      setVoiceActive(true);
      setVoiceState("listening");

      recognition.onresult = (event) => {
        if (browserVoiceProcessingRef.current) return;
        const transcript = Array.from(
          { length: event.results.length - event.resultIndex },
          (_, index) => event.results[event.resultIndex + index],
        ).filter((result) => result.isFinal).map((result) => result[0].transcript).join(" ").trim();
        if (!transcript) return;

        browserVoiceProcessingRef.current = true;
        recognition.stop();
        setVoiceState("thinking");
        setMessages((items) => [...items, { role: "user", content: transcript }, { role: "assistant", content: "" }]);
        let reply = "";
        void (async () => {
          try {
            await streamChatReply(id, transcript, (delta) => {
              reply += delta;
              setMessages((items) => {
                const last = items[items.length - 1];
                return last?.role === "assistant"
                  ? [...items.slice(0, -1), { ...last, content: last.content + delta }]
                  : [...items, { role: "assistant", content: delta }];
              });
            });
            setConversations(await api<Conversation[]>("/api/conversations"));
            if (!reply.trim()) throw new Error("MiMu returned an empty voice response.");
            const utterance = new SpeechSynthesisUtterance(reply);
            const bangla = /[\u0980-\u09ff]/.test(reply);
            utterance.lang = bangla ? "bn-BD" : "en-US";
            const voices = window.speechSynthesis.getVoices();
            const preferredVoice = voices.find((voice) => voice.lang.toLowerCase().startsWith(bangla ? "bn" : "en"));
            if (preferredVoice) utterance.voice = preferredVoice;
            utterance.onend = () => {
              browserVoiceProcessingRef.current = false;
              if (browserVoiceRef.current) {
                setVoiceState("listening");
                try {
                  recognition.start();
                } catch (error) {
                  setError(`Could not restart the microphone: ${(error as Error).message}`);
                  stopVoice();
                }
              }
            };
            utterance.onerror = () => {
              browserVoiceProcessingRef.current = false;
              if (browserVoiceRef.current) {
                setError("Browser voice playback failed. Check your device's audio settings.");
                setVoiceState("listening");
                try {
                  recognition.start();
                } catch {
                  stopVoice();
                }
              }
            };
            setVoiceState("speaking");
            window.speechSynthesis.speak(utterance);
          } catch (error) {
            setError((error as Error).message || "Voice chat failed. Please try again.");
            browserVoiceProcessingRef.current = false;
            if (browserVoiceRef.current) {
              setVoiceState("listening");
              try {
                recognition.start();
              } catch {
                stopVoice();
              }
            }
          }
        })();
      };
      recognition.onerror = (event) => {
        if (!browserVoiceRef.current || event.error === "aborted" || event.error === "no-speech") return;
        const detail = event.error === "not-allowed"
          ? "Microphone permission is blocked. Allow microphone access for this site in Chrome settings."
          : `Browser speech recognition failed: ${event.error}.`;
        setError(detail);
        stopVoice();
      };
      recognition.onend = () => {
        if (!browserVoiceRef.current || browserVoiceProcessingRef.current) return;
        recognitionRestartTimerRef.current = window.setTimeout(() => {
          recognitionRestartTimerRef.current = null;
          if (!browserVoiceRef.current) return;
          try {
            recognition.start();
          } catch {
            setError("The microphone stopped. Press the microphone button to reconnect.");
            stopVoice();
          }
        }, 250);
      };
      recognition.start();
    } catch (error) {
      stopVoice();
      setError((error as Error).message || "Could not start browser voice. Check microphone permission.");
    }
  };

  const startVoice = async () => {
    if (settings?.ai_provider === "gemini" || !settings?.voice_configured) {
      startBrowserVoice();
      return;
    }
    setError("");
    try {
      const session = await api<{ client_secret: string; model: string }>("/api/voice/session", { method: "POST" });
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const id = conversationId ?? crypto.randomUUID();
      voiceConversationRef.current = id;
      if (!conversationId) setConversationId(id);
      const peer = new RTCPeerConnection();
      peerRef.current = peer;
      peer.addTrack(stream.getAudioTracks()[0], stream);
      peer.ontrack = (event) => {
        if (audioRef.current) {
          audioRef.current.srcObject = event.streams[0];
          void audioRef.current.play().catch(() => setError("Audio playback was blocked. Check your browser's audio settings."));
        }
      };
      peer.onconnectionstatechange = () => {
        if (peer.connectionState === "failed") {
          setError("The voice connection failed. Check your network and try reconnecting.");
          stopVoice();
        }
      };
      const channel = peer.createDataChannel("oai-events");
      dataChannelRef.current = channel;
      channel.onmessage = (event) => {
        try {
          const item = JSON.parse(event.data) as { type?: string; transcript?: string };
          if (item.type === "input_audio_buffer.speech_started") setVoiceState("listening");
          if (item.type === "input_audio_buffer.speech_stopped") setVoiceState("thinking");
          if (item.type === "response.created") setVoiceState("thinking");
          if (item.type === "response.audio.delta") setVoiceState("speaking");
          if (item.type === "response.done") setVoiceState("listening");
          if (item.type === "input_audio_buffer.transcription_completed" ||
              item.type === "conversation.item.input_audio_transcription.completed") {
            if (item.transcript) appendVoiceMessage("user", item.transcript);
          }
          if (item.type === "response.output_audio_transcript.done" ||
              item.type === "response.audio_transcript.done") {
            if (item.transcript) appendVoiceMessage("assistant", item.transcript);
          }
        } catch {
          setError("MiMu received an unreadable voice event.");
        }
      };
      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);
      const localSdp = peer.localDescription?.sdp;
      if (!localSdp) throw new Error("Could not initialize the microphone connection.");
      const answerResponse = await fetch(
        `https://api.openai.com/v1/realtime/calls?model=${encodeURIComponent(session.model)}`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${session.client_secret}`, "Content-Type": "application/sdp" },
          body: localSdp,
        },
      );
      if (!answerResponse.ok) throw new Error(`Realtime connection failed (${answerResponse.status}).`);
      const answer = await answerResponse.text();
      await peer.setRemoteDescription({ type: "answer", sdp: answer });
      setVoiceActive(true);
      setVoiceState("listening");
    } catch (err) {
      stopVoice();
      setError((err as Error).message || "Could not start voice. Please check microphone permission.");
    }
  };

  const toggleMute = () => {
    if (browserVoiceActive) return;
    const nextMuted = !muted;
    streamRef.current?.getAudioTracks().forEach((track) => { track.enabled = !nextMuted; });
    setMuted(nextMuted);
  };

  const toggleVoice = () => {
    if (voiceActive) stopVoice();
    else void startVoice();
  };

  const addMemory = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!memoryInput.trim()) return;
    try {
      const created = await api<Memory>("/api/memories", {
        method: "POST",
        body: JSON.stringify({ content: memoryInput.trim() }),
      });
      setMemories((items) => [created, ...items]);
      setMemoryInput("");
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const removeMemory = async (id: number) => {
    try {
      await api(`/api/memories/${id}`, { method: "DELETE" });
      setMemories((items) => items.filter((item) => item.id !== id));
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const toggleAutomation = async () => {
    if (!settings) return;
    setAutomationBusy(true);
    setError("");
    try {
      const result = await api<{ automation_enabled: boolean }>("/api/settings/automation", {
        method: "PUT",
        body: JSON.stringify({ enabled: !settings.automation_enabled }),
      });
      setSettings({ ...settings, automation_enabled: result.automation_enabled });
      if (diagnostics) setDiagnostics({ ...diagnostics, automation: result.automation_enabled ? "enabled" : "disabled" });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setAutomationBusy(false);
    }
  };

  const runConfirmedAction = async () => {
    if (!pendingAction) return;
    setActionRunning(true);
    setActionMessage("");
    try {
      const result = await api<{ status: string; target: string; reply: string }>("/api/automation/execute", {
        method: "POST",
        body: JSON.stringify({
          action_type: pendingAction.action_type,
          target: pendingAction.target,
          confirmed: true,
          conversation_id: pendingAction.conversationId,
          user_message: pendingAction.sourceText,
        }),
      });
      setActionMessage(`Opened ${result.target}.`);
      const sourceText = pendingAction.sourceText;
      if (sourceText) {
        setMessages((items) => [
          ...items,
          { role: "user", content: sourceText },
          { role: "assistant", content: result.reply },
        ]);
        setInput("");
      }
      setPendingAction(null);
      await Promise.all([
        refreshBackend(),
        api<ActionLog[]>("/api/actions").then(setActions),
      ]);
    } catch (err) {
      setPendingAction(null);
      setError((err as Error).message);
    } finally {
      setActionRunning(false);
    }
  };

  const confirmWebsite = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const target = websiteInput.trim();
    if (!target) return;
    let url = target;
    if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
    setPendingAction({ action_type: "website", target: url, label: `Open website ${url}` });
  };

  const sidebar = (
    <aside className={`sidebar ${mobileSidebar ? "sidebar-open" : ""}`}>
      <div className="brand">
        <div className="brand-mark"><span className="brand-flare" /><Sparkles size={18} strokeWidth={2.2} /></div>
        <div><span className="brand-name">MiMu<span className="brand-ai"> AI</span></span><span className="brand-tagline">YOUR PERSONAL INTELLIGENCE</span></div>
        <button className="icon-btn sidebar-close" onClick={() => setMobileSidebar(false)} aria-label="Close menu"><X size={17} /></button>
      </div>
      <button className="new-chat" onClick={startNewConversation}><Plus size={16} /><span>New conversation</span><kbd>⌘ K</kbd></button>
      <div className="side-section">
        <span className="section-label">WORKSPACE</span>
        <button className={`nav-item ${view === "chat" ? "active" : ""}`} onClick={() => { setView("chat"); setMobileSidebar(false); }}><LayoutDashboard size={16} /><span>Assistant</span></button>
        <button className={`nav-item ${view === "memory" ? "active" : ""}`} onClick={() => { setView("memory"); setMobileSidebar(false); }}><Sparkles size={16} /><span>AI Memory</span><span className="nav-count">{memories.length || ""}</span></button>
        <button className={`nav-item ${view === "skills" ? "active" : ""}`} onClick={() => { setView("skills"); setMobileSidebar(false); }}><Zap size={16} /><span>Skills</span><span className="nav-count">08</span></button>
      </div>
      <div className="history-section">
        <div className="history-head"><span className="section-label">RECENT</span></div>
        {conversations.length > 0 ? (
          <div className="history-list">
            {conversations.slice(0, 8).map((conversation) => (
              <div className={`history-row ${conversationId === conversation.id ? "history-active" : ""}`} key={conversation.id}>
                <button className="history-link" onClick={() => void openConversation(conversation.id)} title={conversation.title}>
                  <History size={14} /><span>{conversation.title}</span>
                </button>
                <button className="history-delete" onClick={() => void deleteConversation(conversation.id)} title="Delete conversation" aria-label="Delete conversation"><Trash2 size={13} /></button>
              </div>
            ))}
          </div>
        ) : <p className="empty-history">Your conversations will appear here.</p>}
      </div>
      <div className="sidebar-bottom">
        <div className="system-card">
          <div className="system-card-head"><span className={`status-dot ${backendOnline ? "online" : "offline"}`} /><span>System status</span><MoreHorizontal size={15} /></div>
          <div className="system-line"><span>Backend</span><span className={backendOnline ? "text-success" : "text-muted"}>{backendOnline ? "Connected" : "Offline"}</span></div>
          <div className="system-line"><span>AI engine</span><span className={settings?.ai_configured ? "text-success" : "text-warning"}>{settings?.ai_configured ? "Ready" : "Setup needed"}</span></div>
          <div className="system-line"><span>Memory</span><span className={backendOnline ? "text-success" : "text-muted"}>{backendOnline ? "Local · SQLite" : "Unavailable"}</span></div>
        </div>
        <button className={`nav-item settings-link ${view === "settings" ? "active" : ""}`} onClick={() => { setView("settings"); setMobileSidebar(false); }}><Settings2 size={16} /><span>Settings</span><span className="settings-shortcut">⌘ ,</span></button>
        <div className="profile-row"><div className="profile-avatar">M</div><div className="profile-text"><strong>My workspace</strong><span>Personal account</span></div><ChevronDown size={15} className="profile-chevron" /></div>
      </div>
    </aside>
  );

  const orb = (
    <div className={`orb-wrap orb-${voiceState}`}>
      <div className="orb-halo orb-halo-one" /><div className="orb-halo orb-halo-two" />
      <div className="orb-core"><div className="orb-glow" /><div className="orb-surface" /><span className="orb-center" /></div>
      {voiceState !== "idle" && <div className="orb-ripple" />}
      <div className="orb-sparkle sparkle-one">✦</div><div className="orb-sparkle sparkle-two">·</div>
    </div>
  );

  const renderChat = () => (
    <div className={`chat-view ${messages.length ? "chat-with-messages" : ""}`}>
      {messages.length === 0 ? (
        <div className="welcome">
          <div className="welcome-orb">{orb}</div>
          <div className="eyebrow"><span className="eyebrow-line" /> YOUR PERSONAL AI <span className="eyebrow-line" /></div>
          <h1>Your world,<br /><span>in good hands.</span></h1>
          <p className="welcome-copy">Think out loud. Get things done. Your personal AI is ready when you are.</p>
          {!settings?.ai_configured && backendOnline && (
            <button className="setup-notice" onClick={() => setView("settings")}><KeyRound size={15} /><span><strong>One last step:</strong> add {settings?.ai_provider === "gemini" ? "a Gemini API key to Render" : "an API key to the backend"}.</span><ArrowUp size={14} /></button>
          )}
          {!backendOnline && <div className="setup-notice offline-notice"><Radio size={15} /><span>Start the local backend to connect with MiMu.</span></div>}
          <div className="suggestions">
            {[
              { icon: "✧", text: "Help me plan my day" },
              { icon: "</>", text: "Explain a coding concept" },
              { icon: "↗", text: "Let's brainstorm something" },
            ].map((suggestion) => (
              <button key={suggestion.text} className="suggestion" onClick={() => void sendMessage(suggestion.text)} disabled={!backendOnline || !settings?.ai_configured}>
                <span className="suggestion-icon">{suggestion.icon}</span>{suggestion.text}<ArrowUp size={14} className="suggestion-arrow" />
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="messages-area">
          <AnimatePresence initial={false}>
            {messages.map((message, index) => (
              <motion.article className={`message message-${message.role}`} key={`${index}-${message.content.slice(0, 24)}`} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.22 }}>
                <div className={`message-avatar ${message.role === "assistant" ? "assistant-avatar" : ""}`}>{initials(message.role)}</div>
                <div className="message-content"><div className="message-meta">{message.role === "assistant" ? "MiMu" : "You"}<span>{message.role === "assistant" ? <Sparkles size={11} /> : "·"}</span></div>
                  {message.role === "assistant" ? <div className="markdown"><ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown></div> : <p>{message.content}</p>}
                </div>
              </motion.article>
            ))}
          </AnimatePresence>
          {loading && <div className="message message-assistant"><div className="message-avatar assistant-avatar">M</div><div className="message-content"><div className="message-meta">MiMu<span><Sparkles size={11} /></span></div><div className="thinking-dots"><i /><i /><i /></div></div></div>}
          <div ref={messagesEndRef} />
        </div>
      )}
      <div className="composer-wrap">
        {error && <div className="error-banner" role="alert"><ShieldAlert size={15} /><span>{error}</span><button onClick={() => setError("")} aria-label="Dismiss error"><X size={14} /></button></div>}
        {actionMessage && <div className="success-banner"><Check size={14} />{actionMessage}<button onClick={() => setActionMessage("")} aria-label="Dismiss"><X size={14} /></button></div>}
        <div className="composer">
          <textarea value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={handleComposerKey} placeholder={voiceActive ? "End voice chat to type a message..." : "Message MiMu anything..."} rows={1} aria-label="Message MiMu" disabled={voiceActive} />
          <div className="composer-toolbar">
            <div className="composer-tools">
              <span className="composer-hint">Shift + Enter for a new line</span>
              <button className="tool-button" title="Open VS Code" disabled={!settings?.automation_enabled} onClick={() => setPendingAction({ action_type: "app", target: "Visual Studio Code", label: "Open Visual Studio Code" })}><Command size={15} /></button>
              <button className="tool-button" title="Open a website" disabled={!settings?.automation_enabled} onClick={() => { const url = window.prompt("Website address to open"); if (url) setPendingAction({ action_type: "website", target: /^https?:\/\//i.test(url) ? url : `https://${url}`, label: `Open website ${url}` }); }}><Globe2 size={15} /></button>
            </div>
            <div className="composer-actions">
              <button className={`mic-button ${voiceActive ? "mic-active" : ""}`} onClick={toggleVoice} title={voiceActive ? "Stop voice conversation" : settings?.ai_provider === "gemini" || !settings?.voice_configured ? "Start free browser voice" : "Start OpenAI Realtime voice"} aria-label={voiceActive ? "Stop voice conversation" : "Start voice conversation"} disabled={!voiceActive && (loading || !backendOnline || !settings?.ai_configured)}>
                {voiceActive ? <Square size={14} fill="currentColor" /> : <Mic size={16} />}
              </button>
              {voiceActive && !browserVoiceActive && <button className={`mute-button ${muted ? "muted" : ""}`} onClick={toggleMute} title={muted ? "Unmute microphone" : "Mute microphone"}>{muted ? <MicOff size={15} /> : <Headphones size={15} />}</button>}
              <button className="send-button" onClick={() => void sendMessage()} disabled={!input.trim() || loading || voiceActive} aria-label="Send message">{loading ? <LoaderCircle size={16} className="spin" /> : <ArrowUp size={17} />}</button>
            </div>
          </div>
        </div>
        <div className="composer-footnote"><LockKeyhole size={11} /> History saved locally <span>·</span> Sent to your configured AI provider <span>·</span> MiMu may make mistakes</div>
      </div>
    </div>
  );

  const renderMemory = () => (
    <section className="page-content memory-page">
      <div className="page-eyebrow"><Sparkles size={14} /> PERSONAL CONTEXT</div>
      <h1>Your memory,<br /><span>your choice.</span></h1>
      <p className="page-lede">MiMu only remembers what you explicitly save here. These notes can help personalize future conversations.</p>
      <div className="memory-note"><LockKeyhole size={16} /><span>Never save passwords, API keys, financial details, or other sensitive information.</span></div>
      <form className="memory-form" onSubmit={(event) => void addMemory(event)}>
        <textarea value={memoryInput} onChange={(event) => setMemoryInput(event.target.value)} placeholder="What would you like MiMu to remember?" rows={3} maxLength={2000} />
        <div className="memory-form-bottom"><span>Only you can add or remove these notes.</span><button className="primary-button" disabled={!memoryInput.trim() || !backendOnline}><Plus size={15} /> Save memory</button></div>
      </form>
      <div className="section-title-row"><div><span className="section-label">SAVED NOTES</span><span className="count-pill">{memories.length}</span></div><span className="section-subtitle">Used only to personalize your AI chat</span></div>
      {!backendOnline ? <div className="empty-state"><Radio size={20} /><strong>Backend offline</strong><span>Start the local backend to manage your memories.</span></div> : memories.length ? (
        <div className="memory-list">{memories.map((memory) => <article className="memory-card" key={memory.id}><span className="memory-spark">✦</span><p>{memory.content}</p><time>{new Date(`${memory.created_at}Z`).toLocaleDateString()}</time><button onClick={() => void removeMemory(memory.id)} aria-label="Delete memory" title="Delete memory"><Trash2 size={15} /></button></article>)}</div>
      ) : <div className="empty-state"><Sparkles size={20} /><strong>A little room for what matters.</strong><span>Saved preferences will show up here.</span></div>}
    </section>
  );

  const renderSkills = () => (
    <section className="page-content skills-page">
      <div className="page-eyebrow"><Zap size={14} /> CAPABILITIES</div>
      <h1>One assistant.<br /><span>Many talents.</span></h1>
      <p className="page-lede">MiMu is built to grow with you. Each skill is modular, transparent, and easy to extend.</p>
      <div className="skills-grid">
        {(skills.length ? skills : [
          { id: "general-chat", name: "General AI Chat", description: "Natural language conversations powered by your configured OpenAI model.", available: true },
          { id: "voice", name: "Voice Assistant", description: "Browser speech recognition and spoken replies; OpenAI Realtime is optional.", available: true },
          { id: "coding", name: "Coding Assistant", description: "Programming help, debugging, and technical explanations.", available: true },
          { id: "research", name: "Web Research", description: "Research support. Live web browsing is not connected yet.", available: false },
          { id: "files", name: "File Assistant", description: "Local file access is not enabled yet.", available: false },
          { id: "automation", name: "MacBook Automation", description: "Permission-gated launch of approved apps and websites.", available: true },
          { id: "productivity", name: "Productivity Assistant", description: "Planning, writing, and everyday productivity support.", available: true },
          { id: "memory", name: "Personal Memory", description: "Review and explicitly save personal notes that inform chat replies.", available: true },
        ]).map((skill, index) => <motion.article className={`skill-card ${skill.available ? "" : "skill-unavailable"}`} key={skill.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * 0.04 }}><div className="skill-card-top"><div className={`skill-icon skill-icon-${index % 6}`}>{[<Sparkles key="s" />, <AudioLines key="a" />, <Command key="c" />, <Globe2 key="g" />, <FolderOpen key="f" />, <Shield key="sh" />, <Gauge key="ga" />, <Bot key="b" />][index]}</div><span className={`skill-status ${skill.available ? "skill-ready" : ""}`}>{skill.available ? "READY" : "COMING SOON"}</span></div><h3>{skill.name}</h3><p>{skill.description}</p><div className="skill-footer"><span>{skill.id === "automation" && settings?.automation_enabled ? "Permission enabled" : skill.available ? "MiMu core" : "Not connected"}</span><ArrowUp size={13} className="skill-arrow" /></div></motion.article>)}
      </div>
      <div className="skills-foot"><Shield size={15} /><span>Skills can only act within permissions you&apos;ve explicitly granted.</span></div>
    </section>
  );

  const renderSettings = () => (
    <section className="page-content settings-page">
      <div className="page-eyebrow"><Settings2 size={14} /> YOUR PREFERENCES</div>
      <h1>Make MiMu<br /><span>feel like you.</span></h1>
      <p className="page-lede">Your setup and permissions are managed locally on this Mac.</p>
      {error && <div className="error-banner settings-error" role="alert"><ShieldAlert size={15} /><span>{error}</span><button onClick={() => setError("")} aria-label="Dismiss error"><X size={14} /></button></div>}
      <div className="settings-group">
        <div className="settings-group-title"><KeyRound size={17} /><div><strong>{settings?.ai_provider === "gemini" ? "Gemini free-tier connection" : "OpenAI connection"}</strong><span>The provider key stays in the backend environment, never in the browser.</span></div><span className={`connection-pill ${settings?.ai_configured ? "connected" : "needs-setup"}`}><i />{settings?.ai_configured ? "CONNECTED" : "SETUP NEEDED"}</span></div>
        <div className="settings-detail"><div><strong>{settings?.ai_provider === "gemini" ? "Gemini API key" : "OpenAI API key"}</strong><span>{settings?.ai_configured ? `Stored in ${settings.api_key_source}` : "Not configured"}</span></div><button className="secondary-button" onClick={() => setShowKeyHelp(true)}><KeyRound size={14} />{settings?.ai_configured ? "Key setup" : "How to connect"}</button></div>
        <div className="settings-detail"><div><strong>Text model</strong><span>{settings?.text_model ?? "Waiting for backend"}</span></div><span className="settings-value">{settings?.ai_configured ? "ACTIVE" : "INACTIVE"}</span></div>
        <div className="settings-detail"><div><strong>Voice chat</strong><span>{settings?.ai_provider === "gemini" || !settings?.voice_configured ? "Free browser speech in Chrome; microphone permission is required" : `OpenAI Realtime (${settings.realtime_model} · ${settings.voice})`}</span></div><span className="settings-value">{settings?.ai_provider === "gemini" || !settings?.voice_configured ? "BROWSER" : "WEBRTC"}</span></div>
        {settings?.ai_provider === "gemini" && <div className="memory-note gemini-free-note"><Sparkles size={15} /><span>Gemini&apos;s free tier has usage limits. Google may use free-tier prompts and responses to improve its products. Avoid sending sensitive information.</span></div>}
      </div>
      <div className="settings-group">
        <div className="settings-group-title"><Shield size={17} /><div><strong>Mac automation</strong><span>{settings?.platform === "Darwin" ? "Off by default. Every action requires your confirmation." : "Unavailable on a cloud backend; run MiMu's backend locally on your Mac."}</span></div><span className={`connection-pill ${settings?.automation_enabled ? "connected" : "needs-setup"}`}><i />{settings?.automation_enabled ? "ENABLED" : settings?.platform === "Darwin" ? "DISABLED" : "UNAVAILABLE"}</span></div>
        <div className="settings-detail automation-detail"><div><strong>Approved actions</strong><span>Open VS Code, Terminal, Chrome, Finder, System Settings, or a website.</span></div><button className={`toggle ${settings?.automation_enabled ? "toggle-on" : ""}`} onClick={() => void toggleAutomation()} disabled={!backendOnline || automationBusy || settings?.platform !== "Darwin"} role="switch" aria-checked={settings?.automation_enabled ?? false} aria-label="Enable Mac automation"><span>{automationBusy ? <LoaderCircle size={13} className="spin" /> : null}</span></button></div>
        {settings?.automation_enabled && <div className="emergency-row"><div><ShieldAlert size={15} /><span>Emergency stop disables all new Mac actions.</span></div><button className="stop-button" onClick={() => void toggleAutomation()} disabled={automationBusy}><Square size={12} fill="currentColor" /> STOP</button></div>}
        <form className="website-form" onSubmit={(event) => void confirmWebsite(event)}><div className="website-input-wrap"><Globe2 size={15} /><input value={websiteInput} onChange={(event) => setWebsiteInput(event.target.value)} placeholder="example.com" disabled={!settings?.automation_enabled} aria-label="Website to open" /><button type="submit" disabled={!websiteInput.trim() || !settings?.automation_enabled}>Open with MiMu <ExternalLink size={13} /></button></div></form>
        <div className="settings-actions-grid">{[["Visual Studio Code", "VS"], ["Terminal", ">_"], ["Google Chrome", "CH"], ["Finder", "FI"], ["System Settings", "⚙"]].map(([name, symbol]) => <button key={name} className="app-action" disabled={!settings?.automation_enabled} onClick={() => setPendingAction({ action_type: "app", target: name, label: `Open ${name}` })}><span>{symbol}</span>{name}<ExternalLink size={12} /></button>)}</div>
      </div>
      <div className="settings-group">
        <div className="settings-group-title"><Activity size={17} /><div><strong>System diagnostics</strong><span>A live look at what is working locally.</span></div><button className="refresh-button" onClick={() => void refreshBackend()} aria-label="Refresh diagnostics"><LoaderCircle size={14} /></button></div>
        <div className="diagnostics-grid">{[["Backend", diagnostics?.backend ?? "offline"], ["Local memory", diagnostics?.memory ?? "unavailable"], ["AI provider", diagnostics?.ai ?? "unknown"], ["Mac actions", diagnostics?.automation ?? "disabled"]].map(([name, status]) => <div className="diagnostic" key={name}><span className={`status-dot ${status === "online" || status === "configured" || status === "enabled" ? "online" : "offline"}`} /><span>{name}</span><strong>{status.replace("_", " ")}</strong></div>)}</div>
      </div>
      <div className="settings-group">
        <div className="settings-group-title"><History size={17} /><div><strong>Recent Mac actions</strong><span>Actions MiMu has performed with your approval.</span></div><span className="settings-value">{actions.length} LOGGED</span></div>
        {actions.length ? <div className="action-list">{actions.slice(0, 8).map((action) => <div className="action-log-row" key={action.id}><span className={`action-log-mark ${action.status === "completed" ? "action-done" : ""}`}>{action.status === "completed" ? <Check size={12} /> : <X size={12} />}</span><div><strong>{action.action === "app" ? "Opened application" : "Opened website"}</strong><span>{action.target}</span></div><time>{new Date(`${action.created_at}Z`).toLocaleString()}</time></div>)}</div> : <div className="empty-actions"><Shield size={15} /><span>No actions performed yet. MiMu will ask before running each one.</span></div>}
      </div>
      <div className="privacy-foot"><LockKeyhole size={14} /><span>Chat history is stored in the backend SQLite database. Text is sent to {settings?.ai_provider === "gemini" ? "Google Gemini" : "OpenAI"} when you chat; free-tier prompts may be used to improve Google&apos;s products. Browser voice audio is processed by your browser&apos;s speech service. API keys stay on the backend, never in your browser.</span></div>
    </section>
  );

  return (
    <main className="app-shell">
      {sidebar}
      {mobileSidebar && <button className="mobile-backdrop" onClick={() => setMobileSidebar(false)} aria-label="Close navigation" />}
      <section className="main-panel">
        <header className="topbar">
          <div className="topbar-left"><button className="icon-btn mobile-menu" onClick={() => setMobileSidebar(true)} aria-label="Open menu"><Menu size={19} /></button><div className="breadcrumb"><span>{view === "chat" ? "Workspace" : "Your space"}</span><span className="crumb-slash">/</span><strong>{view === "chat" ? "Assistant" : view === "memory" ? "AI Memory" : view === "skills" ? "Skills" : "Settings"}</strong></div></div>
          <div className="topbar-right"><div className="connection-indicator"><span className={`status-dot ${backendOnline ? "online" : "offline"}`} /><span>{backendOnline ? "All systems normal" : "Backend offline"}</span></div><button className="icon-btn topbar-more" title="Refresh system status" onClick={() => void refreshBackend()}><LoaderCircle size={16} /></button><div className="topbar-avatar">M</div></div>
        </header>
        <div className="content-scroll">
          {view === "chat" && renderChat()}
          {view === "memory" && renderMemory()}
          {view === "skills" && renderSkills()}
          {view === "settings" && renderSettings()}
        </div>
        {view === "chat" && voiceActive && <div className="voice-status"><span className={`voice-state-orb voice-state-${voiceState}`}><i /></span><span className="voice-equalizer"><i /><i /><i /><i /><i /></span><span>{muted ? "Microphone muted" : voiceState === "listening" ? "Listening to you" : voiceState === "thinking" ? "Thinking…" : "MiMu is speaking"}</span><span className="voice-divider" />{!browserVoiceActive && <button onClick={toggleMute} aria-label={muted ? "Unmute microphone" : "Mute microphone"}>{muted ? <MicOff size={15} /> : <Volume2 size={15} />}</button>}<button className="voice-stop" onClick={stopVoice}><Square size={11} fill="currentColor" /> End voice</button></div>}
        <audio ref={audioRef} autoPlay className="sr-only" />
      </section>
      <AnimatePresence>
        {pendingAction && <motion.div className="modal-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={(event) => { if (event.target === event.currentTarget && !actionRunning) setPendingAction(null); }}>
          <motion.div className="confirm-modal" initial={{ opacity: 0, y: 12, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 8 }} role="dialog" aria-modal="true" aria-labelledby="confirm-title">
            <div className="confirm-icon"><Shield size={19} /></div><button className="icon-btn confirm-close" onClick={() => setPendingAction(null)} disabled={actionRunning} aria-label="Close"><X size={17} /></button>
            <span className="page-eyebrow">ACTION APPROVAL</span><h2 id="confirm-title">Before MiMu proceeds</h2><p>MiMu wants to perform this action on your Mac:</p><div className="action-preview"><Command size={17} /><strong>{pendingAction.label}</strong></div><div className="confirm-note"><LockKeyhole size={14} /><span>Only this specific action will run. Nothing else will be executed.</span></div>
            <div className="modal-actions"><button className="secondary-button" onClick={() => setPendingAction(null)} disabled={actionRunning}>Cancel</button><button className="primary-button" onClick={() => void runConfirmedAction()} disabled={actionRunning || !settings?.automation_enabled}>{actionRunning ? <LoaderCircle size={15} className="spin" /> : <Check size={15} />} Confirm and run</button></div>
          </motion.div>
        </motion.div>}
        {showKeyHelp && <motion.div className="modal-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={(event) => { if (event.target === event.currentTarget) setShowKeyHelp(false); }}>
          <motion.div className="confirm-modal key-modal" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} role="dialog" aria-modal="true" aria-labelledby="key-title">
            <button className="icon-btn confirm-close" onClick={() => setShowKeyHelp(false)} aria-label="Close"><X size={17} /></button><div className="confirm-icon"><KeyRound size={19} /></div><span className="page-eyebrow">BACKEND-ONLY KEY</span><h2 id="key-title">Connect your AI</h2><p>{settings?.ai_provider === "gemini" ? "Create a Gemini API key in Google AI Studio. MiMu sends text chat to Google's free tier; its quotas and model access vary, and Google may use free-tier content to improve products." : "MiMu reads your OpenAI key only on the backend. It is never stored in the browser or exposed to the frontend."}</p>
            <ol className="setup-steps"><li><span>1</span><div>Open <a href={settings?.ai_provider === "gemini" ? "https://aistudio.google.com/apikey" : "https://platform.openai.com/api-keys"} target="_blank" rel="noreferrer">{settings?.ai_provider === "gemini" ? "Google AI Studio API keys" : "OpenAI API keys"}</a> and create a key.</div></li><li><span>2</span><div>In Render → your backend service → <strong>Environment</strong>, add <code>{settings?.ai_provider === "gemini" ? "GEMINI_API_KEY" : "OPENAI_API_KEY"}</code> with the new key as its value.</div></li><li><span>3</span><div>Also set <code>AI_PROVIDER={settings?.ai_provider ?? "gemini"}</code> and <code>GEMINI_MODEL=gemini-3.6-flash</code> for the free Gemini text-chat tier. Save and redeploy Render.</div></li></ol><div className="confirm-note"><LockKeyhole size={14} /><span>Never put provider keys in Netlify or share them in chats. Free browser voice is available in supported browsers; OpenAI Realtime is optional.</span></div><div className="modal-actions"><button className="primary-button" onClick={() => setShowKeyHelp(false)}>Got it <Check size={15} /></button></div>
          </motion.div>
        </motion.div>}
      </AnimatePresence>
    </main>
  );
}
