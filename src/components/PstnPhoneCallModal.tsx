import React, { useEffect, useRef, useState } from 'react';
import {
  X,
  PhoneCall,
  PhoneOff,
  Radio,
  Sparkles,
  AlertCircle,
  CheckCircle2,
  RefreshCw,
  Mic,
  Server,
  Clock,
} from 'lucide-react';
import { Candidate, CallScenario, ChatMessage } from '../types';

interface TelephonyConfigStatus {
  provider: 'twilio';
  voiceEngine: 'gemini-3.8-live';
  configured: boolean;
  hasGeminiKey: boolean;
  missingVars: string[];
  fromNumberMasked: string | null;
  publicBaseUrl: string | null;
}

interface ActivePstnCallResponse {
  callId: string;
  twilioCallSid?: string;
  candidateId: string;
  candidateName: string;
  phone: string;
  appliedRole: string;
  scenario: string;
  status: string;
  startedAt: string;
  durationSeconds: number;
  transcript: ChatMessage[];
  summary?: string;
  outcome?: string;
  error?: string;
  finalized: boolean;
}

interface PstnPhoneCallModalProps {
  isOpen: boolean;
  candidate: Candidate | null;
  defaultScenario?: CallScenario;
  onClose: () => void;
  onCallCompleted: (updatedCandidate: Candidate) => void;
  onSwitchToBrowserVoice: (candidate: Candidate, scenario: CallScenario) => void;
}

const TERMINAL_STATUSES = new Set(['completed', 'busy', 'no-answer', 'failed', 'canceled']);

export const PstnPhoneCallModal: React.FC<PstnPhoneCallModalProps> = ({
  isOpen,
  candidate,
  defaultScenario = 'screening',
  onClose,
  onCallCompleted,
  onSwitchToBrowserVoice,
}) => {
  const [config, setConfig] = useState<TelephonyConfigStatus | null>(null);
  const [loadingConfig, setLoadingConfig] = useState(true);
  const [scenario, setScenario] = useState<CallScenario>(defaultScenario);
  const [activeCall, setActiveCall] = useState<ActivePstnCallResponse | null>(null);
  const [isDialing, setIsDialing] = useState(false);
  const [isHangingUp, setIsHangingUp] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const pollTimerRef = useRef<any>(null);
  const finalizedHandledRef = useRef<string | null>(null);

  useEffect(() => {
    setScenario(defaultScenario);
  }, [defaultScenario, candidate?.id]);

  useEffect(() => {
    if (!isOpen) return;
    setLoadingConfig(true);
    setErrorMsg(null);
    fetch('/api/telephony/config')
      .then((res) => res.json())
      .then((data) => setConfig(data))
      .catch((err) => setErrorMsg(err?.message || 'Unable to check telephony server status.'))
      .finally(() => setLoadingConfig(false));

    return () => {
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    };
  }, [isOpen]);

  useEffect(() => {
    if (!activeCall?.callId) return;

    const poll = async () => {
      try {
        const res = await fetch(`/api/telephony/call/${encodeURIComponent(activeCall.callId)}`);
        if (!res.ok) return;
        const data: ActivePstnCallResponse = await res.json();
        setActiveCall(data);

        if ((TERMINAL_STATUSES.has(data.status) || data.finalized) && finalizedHandledRef.current !== data.callId) {
          finalizedHandledRef.current = data.callId;
          if (pollTimerRef.current) {
            clearInterval(pollTimerRef.current);
            pollTimerRef.current = null;
          }
          if (data.candidateId) {
            const candRes = await fetch(`/api/candidate/${encodeURIComponent(data.candidateId)}`);
            if (candRes.ok) {
              const updatedCand = await candRes.json();
              onCallCompleted(updatedCand);
            }
          }
        }
      } catch {
        // Ignore transient poll glitches
      }
    };

    pollTimerRef.current = setInterval(poll, 1500);
    return () => {
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    };
  }, [activeCall?.callId, onCallCompleted]);

  if (!isOpen || !candidate) return null;

  const isCallOngoing =
    Boolean(activeCall) &&
    !TERMINAL_STATUSES.has(activeCall!.status) &&
    !activeCall!.finalized;

  const handleDialCandidate = async () => {
    setIsDialing(true);
    setErrorMsg(null);
    finalizedHandledRef.current = null;
    try {
      const res = await fetch('/api/telephony/call', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          candidateId: candidate.id,
          candidate,
          scenario,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || `Failed to place phone call (HTTP ${res.status})`);
      }
      setActiveCall(data);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Unable to place outbound PSTN call.');
    } finally {
      setIsDialing(false);
    }
  };

  const handleHangUp = async () => {
    if (!activeCall?.callId) return;
    setIsHangingUp(true);
    try {
      const res = await fetch(`/api/telephony/call/${encodeURIComponent(activeCall.callId)}/hangup`, {
        method: 'POST',
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || 'Failed to hang up call.');
      }
      setActiveCall(data);
      const candRes = await fetch(`/api/candidate/${encodeURIComponent(candidate.id)}`);
      if (candRes.ok) {
        const updatedCand = await candRes.json();
        onCallCompleted(updatedCand);
      }
    } catch (err: any) {
      setErrorMsg(err?.message || 'Unable to hang up call.');
    } finally {
      setIsHangingUp(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-black/80 backdrop-blur-md flex items-center justify-center p-3 sm:p-4 animate-in fade-in duration-200">
      <div
        className="w-full max-w-2xl bg-[#0b1322] border border-slate-700/80 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[92vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="bg-[#0e172a] border-b border-slate-800 px-5 py-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-amber-500 to-amber-700 flex items-center justify-center text-white shadow-lg shadow-amber-500/20 shrink-0">
              <PhoneCall className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center flex-wrap gap-2">
                <h3 className="text-base font-bold text-white font-['Space_Grotesk']">
                  Gemini Voice AI — Outbound Phone Call
                </h3>
                <span className="px-2 py-0.5 text-[10px] font-bold uppercase rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                  Twilio + Gemini 3.8 Live
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5 truncate">
                {candidate.name} • {candidate.appliedRole} • <span className="font-mono text-slate-300">{candidate.phone}</span>
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-white p-2 rounded-lg bg-slate-800/80 hover:bg-slate-800 transition cursor-pointer shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4 overflow-y-auto">
          {/* Provider Status Card */}
          <div className="p-3.5 rounded-xl bg-slate-900/90 border border-slate-800 space-y-2 text-xs">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <span className="font-semibold text-slate-200 flex items-center gap-2">
                <Server className="w-4 h-4 text-amber-400" />
                <span>Telephony &amp; Voice Engine Readiness</span>
              </span>
              {loadingConfig ? (
                <span className="text-slate-400 flex items-center gap-1.5">
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  Checking...
                </span>
              ) : config?.configured ? (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 font-semibold">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  PSTN Ready ({config.fromNumberMasked || 'Twilio'})
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-amber-500/15 text-amber-300 border border-amber-500/30 font-semibold">
                  <AlertCircle className="w-3.5 h-3.5" />
                  Server Telephony Vars Needed
                </span>
              )}
            </div>

            {!loadingConfig && config && !config.configured && (
              <div className="text-[11px] text-slate-300 leading-relaxed pt-1 border-t border-slate-800">
                <p>
                  Real PSTN carrier calls use Twilio Programmable Voice bridged to Gemini Live API on the backend.
                  Configure these server environment variables to dial mobile/landline numbers directly:
                </p>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {config.missingVars.map((v) => (
                    <code
                      key={v}
                      className="px-2 py-0.5 rounded bg-slate-950 border border-slate-700 text-amber-300 font-mono text-[10px]"
                    >
                      {v}
                    </code>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Scenario Selection */}
          <div className="space-y-1.5">
            <label className="block text-xs font-semibold text-slate-300">
              AI Recruiter Call Scenario (Agent Arjun)
            </label>
            <select
              value={scenario}
              disabled={isCallOngoing}
              onChange={(e) => setScenario(e.target.value as CallScenario)}
              className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-hidden focus:border-amber-500 disabled:opacity-60"
            >
              <option value="screening">Initial Screening (Experience, CTC, Notice &amp; F2F Slot)</option>
              <option value="reminder">Interview Attendance Reconfirmation (Sector 67 HQ)</option>
              <option value="missed_followup">Missed Interview Follow-up &amp; Reschedule</option>
              <option value="callback_followup">Callback Requested Follow-up</option>
            </select>
          </div>

          {errorMsg && (
            <div className="p-3 rounded-xl bg-rose-950/70 border border-rose-500/40 text-xs text-rose-200 flex items-start gap-2">
              <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
              <span className="break-words">{errorMsg}</span>
            </div>
          )}

          {/* Active / Finished Call Telemetry & Live Transcript */}
          {activeCall && (
            <div className="p-4 rounded-xl bg-slate-950/80 border border-slate-800 space-y-3">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-2 text-xs">
                  <Radio className={`w-4 h-4 ${isCallOngoing ? 'text-emerald-400 animate-pulse' : 'text-slate-400'}`} />
                  <span className="font-bold text-white uppercase tracking-wider">
                    Call Status: {activeCall.status}
                  </span>
                </div>
                <div className="flex items-center gap-2 text-xs text-slate-400 font-mono">
                  <Clock className="w-3.5 h-3.5 text-amber-400" />
                  <span>{activeCall.durationSeconds || 0}s</span>
                </div>
              </div>

              {activeCall.summary && (
                <div className="p-2.5 rounded-lg bg-slate-900 border border-slate-800 text-xs text-slate-200">
                  <strong className="text-amber-400">Summary: </strong>
                  {activeCall.summary}
                </div>
              )}

              <div className="max-h-56 overflow-y-auto space-y-2 pr-1">
                {activeCall.transcript.length === 0 ? (
                  <p className="text-xs text-slate-500 italic">
                    Waiting for candidate to answer and audio stream to start...
                  </p>
                ) : (
                  activeCall.transcript.map((msg) => (
                    <div
                      key={msg.id}
                      className={`p-2 rounded-lg text-xs ${
                        msg.sender === 'agent'
                          ? 'bg-amber-950/25 border border-amber-500/20 text-amber-100'
                          : msg.sender === 'system'
                          ? 'bg-slate-900 border border-slate-800 text-slate-400'
                          : 'bg-slate-800 text-slate-100'
                      }`}
                    >
                      <div className="flex items-center justify-between text-[10px] text-slate-400 font-semibold mb-0.5">
                        <span>{msg.sender === 'agent' ? 'Arjun (Gemini AI)' : msg.sender === 'system' ? 'System' : candidate.name}</span>
                        <span>{msg.timestamp}</span>
                      </div>
                      <div>{msg.text}</div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          {/* Action Footer */}
          <div className="pt-2 border-t border-slate-800 flex flex-wrap items-center justify-between gap-2.5">
            <button
              type="button"
              onClick={() => {
                onClose();
                onSwitchToBrowserVoice(candidate, scenario);
              }}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-amber-300 border border-amber-500/30 transition cursor-pointer"
            >
              <Mic className="w-3.5 h-3.5 text-amber-400" />
              <span>Use Gemini Live Call (Browser Mic)</span>
            </button>

            <div className="flex items-center gap-2 ml-auto">
              {isCallOngoing ? (
                <button
                  type="button"
                  onClick={handleHangUp}
                  disabled={isHangingUp}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold bg-rose-600 hover:bg-rose-500 text-white transition cursor-pointer disabled:opacity-50"
                >
                  <PhoneOff className="w-3.5 h-3.5" />
                  <span>{isHangingUp ? 'Ending...' : 'Hang Up Call'}</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleDialCandidate}
                  disabled={isDialing || !config?.configured}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 shadow-md shadow-amber-500/20 transition cursor-pointer disabled:opacity-45 disabled:cursor-not-allowed"
                >
                  {isDialing ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      <span>Dialing {candidate.phone}...</span>
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-3.5 h-3.5" />
                      <span>Dial Candidate Phone</span>
                    </>
                  )}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
