import React from 'react';
import { PhoneCall, PhoneOff, Building2, Globe, Plus, RefreshCw, Brain, LogIn, LogOut, User as UserIcon } from 'lucide-react';
import { Candidate } from '../types';
import { VapiCallStatus } from '../utils/vapiService';
import { FirebaseUser } from '../utils/firebase';

interface HeaderProps {
  onNewCandidate: () => void;
  onQuickStartCall: () => void;
  onStartInteractiveCall?: () => void;
  onEndCall?: () => void;
  onOpenBrainModal?: () => void;
  vapiCallStatus?: VapiCallStatus;
  activeCandidateCount: number;
  currentUser?: FirebaseUser | null;
  onSignIn?: () => void;
  onSignOut?: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  onNewCandidate,
  onQuickStartCall,
  onStartInteractiveCall,
  onEndCall,
  onOpenBrainModal,
  vapiCallStatus = 'idle',
  activeCandidateCount,
  currentUser,
  onSignIn,
  onSignOut,
}) => {
  return (
    <header className="bg-[#0f172a] border-b border-slate-800 sticky top-0 z-30 shadow-md">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3.5">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          {/* Brand & Identity */}
          <div className="flex items-center space-x-3.5">
            <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-amber-500 via-amber-600 to-amber-700 flex items-center justify-center shadow-lg shadow-amber-500/20 border border-amber-400/30">
              <Building2 className="w-6 h-6 text-white" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <span className="font-extrabold text-lg sm:text-xl tracking-tight text-white font-['Space_Grotesk']">
                  WHITE COLLAR <span className="text-amber-400 font-normal">REALTY</span>
                </span>
                <span className="px-2 py-0.5 text-[11px] font-semibold tracking-wide uppercase rounded-md bg-amber-500/10 text-amber-400 border border-amber-500/20">
                  Virtual HR AI
                </span>
              </div>
              <p className="text-xs text-slate-400 flex items-center gap-2 mt-0.5">
                <span>Gurgaon & Dubai Luxury Real Estate Advisory</span>
                <span className="text-slate-600">•</span>
                <span className="inline-flex items-center gap-1 text-emerald-400">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  Agent Arjun (Vapi Voice) Online
                </span>
              </p>
            </div>
          </div>

          {/* Quick Actions & Meta */}
          <div className="flex items-center gap-2.5 flex-wrap">
            <div className="hidden md:flex items-center text-xs text-slate-400 bg-slate-800/80 px-3 py-1.5 rounded-lg border border-slate-700/60">
              <Globe className="w-3.5 h-3.5 mr-1.5 text-amber-400" />
              <span>Languages: <strong className="text-slate-200">Hindi, English, Hinglish</strong></span>
            </div>

            {onOpenBrainModal && (
              <button
                id="btn-open-ai-brain"
                onClick={onOpenBrainModal}
                className="inline-flex items-center gap-1.5 text-xs font-bold bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 border border-amber-500/40 px-3 py-2 rounded-lg transition shadow-xs"
                title="Open Central AI HR Brain - 6 Memory Layers & Self-Learning System"
              >
                <Brain className="w-3.5 h-3.5 text-amber-400 animate-pulse" />
                <span>AI HR Brain</span>
              </button>
            )}

            {/* Google Sign-in / User Profile */}
            {currentUser ? (
              <div className="flex items-center gap-2 bg-slate-800/90 border border-slate-700/80 px-2.5 py-1.5 rounded-lg">
                {currentUser.photoURL ? (
                  <img 
                    src={currentUser.photoURL} 
                    alt={currentUser.displayName || 'HR Recruiter'} 
                    className="w-5 h-5 rounded-full border border-amber-400/50 object-cover"
                  />
                ) : (
                  <div className="w-5 h-5 rounded-full bg-amber-500/20 text-amber-400 flex items-center justify-center text-[10px] font-bold">
                    <UserIcon className="w-3 h-3" />
                  </div>
                )}
                <span className="text-xs text-slate-200 font-medium max-w-[110px] truncate">
                  {currentUser.displayName || currentUser.email?.split('@')[0]}
                </span>
                {onSignOut && (
                  <button
                    onClick={onSignOut}
                    className="text-slate-400 hover:text-rose-400 p-0.5 rounded transition"
                    title="Sign Out"
                  >
                    <LogOut className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            ) : onSignIn ? (
              <button
                onClick={onSignIn}
                className="inline-flex items-center gap-1.5 text-xs font-semibold bg-white hover:bg-slate-100 text-slate-900 px-3 py-2 rounded-lg shadow-sm transition active:scale-95"
                title="Sign in with Google"
              >
                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24">
                  <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                  <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                  <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" />
                  <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" />
                </svg>
                <span>Google Sign-In</span>
              </button>
            ) : null}

            <button
              id="btn-add-dummy-candidate"
              onClick={onNewCandidate}
              className="inline-flex items-center gap-1.5 text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 px-3 py-2 rounded-lg border border-slate-700 transition"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Add Candidate</span>
            </button>

            {/* Vapi Call State Button Group */}
            {vapiCallStatus === 'connecting' && (
              <button
                id="btn-quick-call-start"
                disabled
                className="inline-flex items-center gap-2 text-xs font-semibold bg-amber-500/80 text-slate-950 px-4 py-2 rounded-lg shadow-md transition cursor-wait animate-pulse"
              >
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                <span>Connecting...</span>
              </button>
            )}

            {vapiCallStatus === 'active' && (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={onQuickStartCall}
                  className="inline-flex items-center gap-2 text-xs font-bold bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/40 px-3.5 py-2 rounded-lg shadow-xs shadow-emerald-950/40 animate-pulse transition"
                  title="View active call"
                >
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping inline-block" />
                  <span>Call Active</span>
                </button>
                <button
                  id="btn-quick-call-end"
                  onClick={onEndCall}
                  className="inline-flex items-center gap-1.5 text-xs font-bold bg-rose-600 hover:bg-rose-500 text-white px-3.5 py-2 rounded-lg shadow-md shadow-rose-900/30 transition active:scale-95 cursor-pointer"
                  title="End Active Vapi Voice Call"
                >
                  <PhoneOff className="w-3.5 h-3.5" />
                  <span>End Call</span>
                </button>
              </div>
            )}

            {(vapiCallStatus === 'idle' || vapiCallStatus === 'ended' || vapiCallStatus === 'error' || vapiCallStatus === 'key_required') && (
              <div className="flex items-center gap-2">
                {onStartInteractiveCall && (
                  <button
                    id="btn-interactive-call-start"
                    onClick={onStartInteractiveCall}
                    className="inline-flex items-center gap-1.5 text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-amber-300 border border-amber-500/30 px-3 py-2 rounded-lg transition active:scale-95 shadow-xs"
                    title="Start Voice Screening with AI Recruiter Arjun"
                  >
                    <PhoneCall className="w-3.5 h-3.5 text-amber-400" />
                    <span>AI Voice Recruiter</span>
                  </button>
                )}
                <button
                  id="btn-quick-call-start"
                  onClick={onQuickStartCall}
                  className="inline-flex items-center gap-2 text-xs font-semibold bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 px-4 py-2 rounded-lg shadow-md shadow-amber-500/20 transition active:scale-95"
                  title="Connect via Vapi WebRTC"
                >
                  <PhoneCall className="w-3.5 h-3.5" />
                  <span>Vapi Live Call</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
};
