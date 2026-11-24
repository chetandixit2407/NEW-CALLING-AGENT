import { GoogleGenAI } from '@google/genai';
import { Candidate, CallRecord, ChatMessage, InterviewSlot } from '../../src/types';
import { candidateRepository } from '../repositories/candidateRepository';
import { interviewSlotRepository } from '../repositories/interviewSlotRepository';
import { aiHrBrain } from '../ai/hrBrain';

export type PstnCallStatus =
  | 'initiating'
  | 'queued'
  | 'ringing'
  | 'in-progress'
  | 'completed'
  | 'busy'
  | 'no-answer'
  | 'failed'
  | 'canceled';

export interface ActivePstnCall {
  callId: string;
  twilioCallSid?: string;
  streamSid?: string;
  candidateId: string;
  candidateName: string;
  phone: string;
  appliedRole: string;
  scenario: string;
  status: PstnCallStatus;
  startedAt: string;
  connectedAt?: string;
  endedAt?: string;
  durationSeconds: number;
  transcript: ChatMessage[];
  extractedFields: Record<string, any>;
  bookedSlotId?: string;
  outcome?: string;
  callbackTime?: string;
  declineReason?: string;
  summary?: string;
  error?: string;
  finalized: boolean;
}

export interface TelephonyConfigStatus {
  provider: 'twilio';
  voiceEngine: 'gemini-3.8-live';
  configured: boolean;
  hasGeminiKey: boolean;
  missingVars: string[];
  fromNumberMasked: string | null;
  publicBaseUrl: string | null;
}

function getEnvVar(name: string): string {
  return (process.env[name] || '').trim();
}

export function normalizePhoneToE164(rawPhone: string): string {
  const cleaned = (rawPhone || '').replace(/[^\d+]/g, '');
  if (!cleaned) return '';
  if (cleaned.startsWith('+')) return cleaned;
  // Default 10-digit Indian mobile numbers to +91
  if (/^\d{10}$/.test(cleaned)) {
    return `+91${cleaned}`;
  }
  if (/^91\d{10}$/.test(cleaned)) {
    return `+${cleaned}`;
  }
  return `+${cleaned}`;
}

function escapeXml(str: string): string {
  return (str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

class TwilioTelephonyService {
  private calls: Map<string, ActivePstnCall> = new Map();
  private sidToCallId: Map<string, string> = new Map();

  public getConfigStatus(requestBaseUrl?: string): TelephonyConfigStatus {
    const accountSid = getEnvVar('TWILIO_ACCOUNT_SID');
    const authToken = getEnvVar('TWILIO_AUTH_TOKEN');
    const fromNumber = getEnvVar('TWILIO_PHONE_NUMBER');
    const envPublicUrl = getEnvVar('PUBLIC_BASE_URL');
    const geminiKey = getEnvVar('GEMINI_API_KEY');

    const resolvedPublicUrl = (envPublicUrl || requestBaseUrl || '').replace(/\/+$/, '') || null;
    const isLocalOnly =
      !resolvedPublicUrl ||
      resolvedPublicUrl.includes('localhost') ||
      resolvedPublicUrl.includes('127.0.0.1') ||
      resolvedPublicUrl.includes('0.0.0.0');

    const missingVars: string[] = [];
    if (!geminiKey) missingVars.push('GEMINI_API_KEY');
    if (!accountSid) missingVars.push('TWILIO_ACCOUNT_SID');
    if (!authToken) missingVars.push('TWILIO_AUTH_TOKEN');
    if (!fromNumber) missingVars.push('TWILIO_PHONE_NUMBER');
    if (isLocalOnly && !envPublicUrl) {
      missingVars.push('PUBLIC_BASE_URL');
    }

    const fromNumberMasked = fromNumber
      ? fromNumber.length > 6
        ? `${fromNumber.slice(0, 4)}****${fromNumber.slice(-4)}`
        : 'Configured'
      : null;

    return {
      provider: 'twilio',
      voiceEngine: 'gemini-3.8-live',
      configured: Boolean(geminiKey && accountSid && authToken && fromNumber && resolvedPublicUrl && !isLocalOnly),
      hasGeminiKey: Boolean(geminiKey),
      missingVars,
      fromNumberMasked,
      publicBaseUrl: resolvedPublicUrl,
    };
  }

  public getCall(callId: string): ActivePstnCall | undefined {
    return this.calls.get(callId);
  }

  public getCallBySid(sid: string): ActivePstnCall | undefined {
    const callId = this.sidToCallId.get(sid);
    return callId ? this.calls.get(callId) : undefined;
  }

  public getRecentCalls(limitCount: number = 25): ActivePstnCall[] {
    return Array.from(this.calls.values())
      .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime())
      .slice(0, limitCount);
  }

  public buildTwimlResponse(params: {
    wsStreamUrl: string;
    callId: string;
    candidateId: string;
    scenario: string;
  }): string {
    return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <Stream url="${escapeXml(params.wsStreamUrl)}">
      <Parameter name="callId" value="${escapeXml(params.callId)}" />
      <Parameter name="candidateId" value="${escapeXml(params.candidateId)}" />
      <Parameter name="scenario" value="${escapeXml(params.scenario)}" />
    </Stream>
  </Connect>
</Response>`;
  }

  public async initiateOutboundCall(params: {
    candidate: Candidate;
    scenario?: string;
    requestBaseUrl?: string;
    lockId?: string;
  }): Promise<ActivePstnCall> {
    const { candidate, scenario = 'screening', requestBaseUrl, lockId } = params;
    const cfg = this.getConfigStatus(requestBaseUrl);

    if (!cfg.configured || !cfg.publicBaseUrl) {
      throw new Error(
        `PSTN phone calling requires Twilio & Gemini configuration. Missing: ${cfg.missingVars.join(', ')}. Use "Gemini Live Call" for browser microphone screening or configure Twilio environment variables on the server.`
      );
    }

    const toPhone = normalizePhoneToE164(candidate.phone);
    if (!toPhone || toPhone.length < 8) {
      throw new Error(`Invalid candidate phone number "${candidate.phone}".`);
    }

    const callId = lockId || `pstn_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

    // Acquire atomic calling lock
    const lockResult = await candidateRepository.acquireCallingLock(candidate.id, callId, 10);
    if (!lockResult.success) {
      throw new Error(
        lockResult.reason === 'ALREADY_IN_CALL'
          ? `Candidate ${candidate.name} already has an active call in progress.`
          : `Unable to lock candidate record for calling (${lockResult.reason || 'unknown'}).`
      );
    }

    const callRecord: ActivePstnCall = {
      callId,
      candidateId: candidate.id,
      candidateName: candidate.name,
      phone: toPhone,
      appliedRole: candidate.appliedRole || 'Luxury Sales Consultant',
      scenario,
      status: 'initiating',
      startedAt: new Date().toISOString(),
      durationSeconds: 0,
      transcript: [],
      extractedFields: {},
      finalized: false,
    };
    this.calls.set(callId, callRecord);

    // Ensure candidate exists in repository for Twilio stream lookup
    await candidateRepository.saveCandidate(candidate);

    const accountSid = getEnvVar('TWILIO_ACCOUNT_SID');
    const authToken = getEnvVar('TWILIO_AUTH_TOKEN');
    const fromNumber = normalizePhoneToE164(getEnvVar('TWILIO_PHONE_NUMBER'));

    const twimlUrl = `${cfg.publicBaseUrl}/api/telephony/twiml?callId=${encodeURIComponent(callId)}&candidateId=${encodeURIComponent(candidate.id)}&scenario=${encodeURIComponent(scenario)}`;
    const statusCallbackUrl = `${cfg.publicBaseUrl}/api/telephony/status?callId=${encodeURIComponent(callId)}`;

    const formBody = new URLSearchParams({
      To: toPhone,
      From: fromNumber,
      Url: twimlUrl,
      Method: 'POST',
      StatusCallback: statusCallbackUrl,
      StatusCallbackMethod: 'POST',
      Timeout: '35',
    });
    formBody.append('StatusCallbackEvent', 'initiated');
    formBody.append('StatusCallbackEvent', 'ringing');
    formBody.append('StatusCallbackEvent', 'answered');
    formBody.append('StatusCallbackEvent', 'completed');

    try {
      const authHeader = Buffer.from(`${accountSid}:${authToken}`).toString('base64');
      const twilioRes = await fetch(
        `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Calls.json`,
        {
          method: 'POST',
          headers: {
            Authorization: `Basic ${authHeader}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: formBody.toString(),
        }
      );

      const twilioData: any = await twilioRes.json().catch(() => ({}));

      if (!twilioRes.ok) {
        const msg = twilioData?.message || `Twilio API returned HTTP ${twilioRes.status}`;
        callRecord.status = 'failed';
        callRecord.error = msg;
        callRecord.endedAt = new Date().toISOString();
        await candidateRepository.releaseCallingLock(candidate.id, callId);
        throw new Error(`Twilio outbound call failed: ${msg}`);
      }

      callRecord.twilioCallSid = twilioData.sid;
      callRecord.status = (twilioData.status as PstnCallStatus) || 'queued';
      if (twilioData.sid) {
        this.sidToCallId.set(twilioData.sid, callId);
      }

      return callRecord;
    } catch (err: any) {
      callRecord.status = 'failed';
      callRecord.error = err?.message || 'Failed to place Twilio call';
      callRecord.endedAt = new Date().toISOString();
      await candidateRepository.releaseCallingLock(candidate.id, callId);
      throw err;
    }
  }

  public async hangupCall(callId: string): Promise<ActivePstnCall> {
    const call = this.calls.get(callId);
    if (!call) {
      throw new Error(`Call ${callId} not found.`);
    }

    if (call.twilioCallSid) {
      const accountSid = getEnvVar('TWILIO_ACCOUNT_SID');
      const authToken = getEnvVar('TWILIO_AUTH_TOKEN');
      if (accountSid && authToken) {
        const authHeader = Buffer.from(`${accountSid}:${authToken}`).toString('base64');
        const body = new URLSearchParams({ Status: 'completed' });
        const res = await fetch(
          `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Calls/${encodeURIComponent(call.twilioCallSid)}.json`,
          {
            method: 'POST',
            headers: {
              Authorization: `Basic ${authHeader}`,
              'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: body.toString(),
          }
        );
        if (!res.ok) {
          const errData: any = await res.json().catch(() => ({}));
          throw new Error(errData?.message || `Failed to hang up call (${res.status})`);
        }
      }
    }

    call.status = 'completed';
    await this.finalizePstnCall(callId);
    return call;
  }

  public appendTranscript(callId: string, sender: 'agent' | 'candidate' | 'system', text: string, appendToLastAgent: boolean = false) {
    const call = this.calls.get(callId);
    if (!call || !text) return;

    const timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const last = call.transcript[call.transcript.length - 1];

    if (appendToLastAgent && sender === 'agent' && last && last.sender === 'agent') {
      last.text += text;
      return;
    }

    if (sender === 'candidate' && last && last.sender === 'candidate') {
      last.text = text;
      return;
    }

    call.transcript.push({
      id: `pstn-msg-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      sender,
      text,
      timestamp,
    });
  }

  public applyToolCall(callId: string, name: string, args: Record<string, any>) {
    const call = this.calls.get(callId);
    if (!call) return;

    if (name === 'updateCandidateScreening') {
      if (args.currentCompany) call.extractedFields.currentCompany = args.currentCompany;
      if (args.currentDesignation) call.extractedFields.currentDesignation = args.currentDesignation;
      if (args.totalExperienceYears !== undefined) call.extractedFields.totalExperienceYears = args.totalExperienceYears;
      if (args.realEstateExperienceYears !== undefined) call.extractedFields.realEstateExperienceYears = args.realEstateExperienceYears;
      if (args.currentSalaryLPA) call.extractedFields.currentSalaryLPA = args.currentSalaryLPA;
      if (args.expectedSalaryLPA) call.extractedFields.expectedSalaryLPA = args.expectedSalaryLPA;
      if (args.noticePeriodDays !== undefined) call.extractedFields.noticePeriodDays = args.noticePeriodDays;
      if (args.currentLocation) call.extractedFields.currentLocation = args.currentLocation;
      if (args.earliestJoiningDate) call.extractedFields.earliestJoiningDate = args.earliestJoiningDate;
      if (args.hasGurgaonExperience !== undefined || args.hasDubaiExperience !== undefined) {
        call.extractedFields.gurgaonDubaiExperience = {
          gurgaon: args.hasGurgaonExperience ?? call.extractedFields.gurgaonDubaiExperience?.gurgaon ?? false,
          dubai: args.hasDubaiExperience ?? call.extractedFields.gurgaonDubaiExperience?.dubai ?? false,
          details: args.gurgaonDubaiDetails || call.extractedFields.gurgaonDubaiExperience?.details || '',
        };
      }
    } else if (name === 'scheduleFaceToFaceInterview') {
      if (args.selectedSlotId) {
        call.bookedSlotId = args.selectedSlotId;
      }
      call.extractedFields.preferredInterviewSlot = `${args.interviewDate || 'Upcoming'} ${args.interviewTime || ''}`.trim();
      if (args.venueConfirmed !== undefined) {
        call.extractedFields.interviewVenueConfirmed = args.venueConfirmed;
      }
    } else if (name === 'recordCallDisposition') {
      if (args.outcome) call.outcome = args.outcome;
      if (args.callbackTime) call.callbackTime = args.callbackTime;
      if (args.declineReason) call.declineReason = args.declineReason;
    }
  }

  public async handleStatusWebhook(body: Record<string, any>, queryCallId?: string): Promise<void> {
    const sid = body.CallSid;
    const rawStatus = (body.CallStatus || '').toLowerCase() as PstnCallStatus;
    const duration = body.CallDuration ? parseInt(body.CallDuration, 10) : undefined;

    const call = (queryCallId && this.calls.get(queryCallId)) || (sid ? this.getCallBySid(sid) : undefined);
    if (!call) return;

    if (sid && !call.twilioCallSid) {
      call.twilioCallSid = sid;
      this.sidToCallId.set(sid, call.callId);
    }

    if (rawStatus) {
      call.status = rawStatus;
    }
    if (rawStatus === 'in-progress' && !call.connectedAt) {
      call.connectedAt = new Date().toISOString();
    }
    if (duration !== undefined && !Number.isNaN(duration)) {
      call.durationSeconds = duration;
    }

    if (['completed', 'busy', 'no-answer', 'failed', 'canceled'].includes(rawStatus)) {
      await this.finalizePstnCall(call.callId, rawStatus);
    }
  }

  public async finalizePstnCall(callId: string, terminalStatus?: string): Promise<void> {
    const call = this.calls.get(callId);
    if (!call || call.finalized) return;
    call.finalized = true;
    call.endedAt = new Date().toISOString();

    if (!call.durationSeconds && call.connectedAt) {
      call.durationSeconds = Math.max(
        1,
        Math.round((new Date(call.endedAt).getTime() - new Date(call.connectedAt).getTime()) / 1000)
      );
    }

    try {
      const candidate = await candidateRepository.getCandidate(call.candidateId);
      if (!candidate) return;

      const effectiveStatus = terminalStatus || call.status;

      // Handle unanswered / busy / failed PSTN outcomes without AI fabrication
      if (['no-answer', 'busy', 'failed', 'canceled'].includes(effectiveStatus) && call.transcript.length === 0) {
        const nextUnanswered = (candidate.unansweredAttempts || 0) + 1;
        const nextStatus =
          effectiveStatus === 'busy'
            ? 'Busy - Retry Scheduled'
            : effectiveStatus === 'failed'
            ? candidate.status
            : 'Unanswered - Retry Scheduled';

        const summaryText = `PSTN phone call (${effectiveStatus}) to ${candidate.phone} via Gemini Voice AI + Twilio.`;
        call.summary = summaryText;
        call.outcome = effectiveStatus.toUpperCase();

        const record: CallRecord = {
          id: call.callId,
          candidateId: candidate.id,
          candidateName: candidate.name,
          timestamp: new Date().toLocaleString([], { dateStyle: 'short', timeStyle: 'short' }),
          scenario: (call.scenario as any) || 'screening',
          durationSeconds: call.durationSeconds || 0,
          transcript: [
            {
              id: `sys-${Date.now()}`,
              sender: 'system',
              text: summaryText,
              timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            },
          ],
          summary: summaryText,
          outcome: nextStatus,
          extractedFields: {},
        };

        await candidateRepository.updateCandidate(candidate.id, {
          status: nextStatus,
          unansweredAttempts: nextUnanswered,
          callCount: (candidate.callCount || 0) + 1,
          lastCallDate: new Date().toISOString().replace('T', ' ').substring(0, 16),
          lastCallAt: call.endedAt,
          notes: summaryText,
          callHistory: [record, ...(candidate.callHistory || [])],
        });
        return;
      }

      // Run full AI HR Brain post-call completion for answered calls with transcripts
      const slots: InterviewSlot[] = await interviewSlotRepository.getAllSlots();
      let genAIClient: GoogleGenAI | null = null;
      const apiKey = getEnvVar('GEMINI_API_KEY');
      if (apiKey) {
        genAIClient = new GoogleGenAI({
          apiKey,
          httpOptions: { headers: { 'User-Agent': 'aistudio-build' } },
        });
      }

      const brainResult = await aiHrBrain.processCallCompletion({
        candidate: {
          ...candidate,
          screening: {
            ...candidate.screening,
            ...call.extractedFields,
          },
        },
        transcript: call.transcript,
        callScenario: call.scenario || 'screening',
        callDuration: call.durationSeconds || 30,
        availableSlots: slots,
        bookedSlotId: call.bookedSlotId,
        conversationId: call.callId,
        genAIClient,
      });

      const finalSlotId = brainResult?.statusAnalysis?.bookedSlotId || call.bookedSlotId;
      let chosenSlot: InterviewSlot | undefined;
      if (finalSlotId) {
        chosenSlot = slots.find((s) => s.id === finalSlotId);
        if (chosenSlot) {
          await interviewSlotRepository.bookSlot(finalSlotId, candidate.id, candidate.name).catch(() => {});
        }
      }

      const mergedScreening = {
        ...candidate.screening,
        ...call.extractedFields,
        ...(brainResult?.extractedFields || {}),
      };

      const analyzedStatus = brainResult?.statusAnalysis?.candidateStatus || candidate.status;
      const analyzedInterviewStatus = brainResult?.statusAnalysis?.interviewStatus || candidate.interviewStatus;

      call.summary = brainResult.summary;
      call.outcome = analyzedStatus;

      const record: CallRecord = {
        id: call.callId,
        candidateId: candidate.id,
        candidateName: candidate.name,
        timestamp: new Date().toLocaleString([], { dateStyle: 'short', timeStyle: 'short' }),
        scenario: (call.scenario as any) || 'screening',
        durationSeconds: call.durationSeconds || 30,
        transcript: call.transcript,
        summary: brainResult.summary,
        outcome: analyzedStatus,
        extractedFields: mergedScreening,
        callbackTime: brainResult?.statusAnalysis?.callbackTime || call.callbackTime,
        declineReason: brainResult?.statusAnalysis?.declineReason || call.declineReason,
        hrDecisionOutcome: brainResult?.statusAnalysis?.hrDecisionOutcome as any,
        afterCallAction: brainResult?.afterCallAction as any,
        behaviorReport: brainResult?.behaviorReport,
      };

      const remark = brainResult.factBasedRemark;
      await candidateRepository.updateCandidate(candidate.id, {
        status: analyzedStatus,
        interviewStatus: analyzedInterviewStatus as any,
        screening: mergedScreening,
        interviewSlotId: finalSlotId || candidate.interviewSlotId,
        interviewDate: chosenSlot?.date || candidate.interviewDate,
        interviewTime: chosenSlot?.time || candidate.interviewTime,
        interviewVenue: chosenSlot?.venue || candidate.interviewVenue,
        lastCallDate: new Date().toISOString().replace('T', ' ').substring(0, 16),
        lastCallAt: call.endedAt,
        callCount: (candidate.callCount || 0) + 1,
        callbackTime: brainResult?.statusAnalysis?.callbackTime || call.callbackTime || candidate.callbackTime,
        declineReason: brainResult?.statusAnalysis?.declineReason || call.declineReason || candidate.declineReason,
        notes: brainResult.summary,
        scorecard: (brainResult.scorecard as any) || candidate.scorecard,
        afterCallAction: brainResult.afterCallAction as any,
        latestBehaviorReport: brainResult.behaviorReport,
        latestRemark: remark
          ? {
              id: `rem-${Date.now()}`,
              text: remark.text,
              priority: (remark.priority as any) || 'High',
              category: (remark.category as any) || 'Interview Scheduled',
              createdAt: new Date().toISOString(),
              actionDueDate: remark.actionDueDate || 'Today',
              author: 'Arjun (Gemini Voice AI + PSTN)',
            }
          : candidate.latestRemark,
        callHistory: [record, ...(candidate.callHistory || [])],
      });
    } catch (err) {
      console.error(`[TwilioTelephonyService] Finalization error for call ${callId}:`, err);
    } finally {
      await candidateRepository.releaseCallingLock(call.candidateId, callId);
    }
  }
}

export const twilioTelephonyService = new TwilioTelephonyService();
