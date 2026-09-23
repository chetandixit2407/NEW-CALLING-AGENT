import fs from 'fs';
import path from 'path';
import { db, doc, writeBatch, getDocs, collection } from '../services/firestoreDb';
import { INITIAL_CANDIDATES, INITIAL_INTERVIEW_SLOTS } from '../../src/data/mockCandidates';

const DATA_DIR = path.join(process.cwd(), 'data');

export interface MigrationSummary {
  candidatesMigrated: number;
  interviewSlotsMigrated: number;
  candidateMemoriesMigrated: number;
  behaviorReportsMigrated: number;
  callLogsMigrated: number;
  humanFeedbackMigrated: number;
  learningProposalsMigrated: number;
  memoryAuditMigrated: number;
  questionStatsMigrated: number;
  errors: string[];
}

function readJsonFile<T>(filename: string, fallback: T): T {
  try {
    const fullPath = path.join(DATA_DIR, filename);
    if (!fs.existsSync(fullPath)) return fallback;
    const content = fs.readFileSync(fullPath, 'utf-8');
    return JSON.parse(content);
  } catch (err: any) {
    console.warn(`[Migration] Warning reading ${filename}:`, err.message);
    return fallback;
  }
}

export async function runJsonToFirestoreMigration(): Promise<MigrationSummary> {
  console.log('[Migration] Starting JSON to Firestore data migration...');
  const summary: MigrationSummary = {
    candidatesMigrated: 0,
    interviewSlotsMigrated: 0,
    candidateMemoriesMigrated: 0,
    behaviorReportsMigrated: 0,
    callLogsMigrated: 0,
    humanFeedbackMigrated: 0,
    learningProposalsMigrated: 0,
    memoryAuditMigrated: 0,
    questionStatsMigrated: 0,
    errors: [],
  };

  try {
    // 1. Migrate Candidates
    try {
      const candidatesBatch = writeBatch(db);
      const localCandidatesFile = path.join(DATA_DIR, 'candidates.json');
      let candidatesList: any[] = [];
      if (fs.existsSync(localCandidatesFile)) {
        candidatesList = readJsonFile<any[]>('candidates.json', []);
      }
      if (candidatesList.length === 0) {
        candidatesList = INITIAL_CANDIDATES;
      }

      for (const cand of candidatesList) {
        if (cand.id) {
          const ref = doc(db, 'candidates', cand.id);
          candidatesBatch.set(ref, { ...cand, migratedAt: new Date().toISOString() }, { merge: true });
          summary.candidatesMigrated++;
        }
      }
      await candidatesBatch.commit();
      console.log(`[Migration] Candidates migrated: ${summary.candidatesMigrated}`);
    } catch (err: any) {
      summary.errors.push(`Candidates migration error: ${err.message}`);
    }

    // 2. Migrate Interview Slots
    try {
      const slotsBatch = writeBatch(db);
      for (const slot of INITIAL_INTERVIEW_SLOTS) {
        if (slot.id) {
          const ref = doc(db, 'interview_slots', slot.id);
          slotsBatch.set(ref, { ...slot, migratedAt: new Date().toISOString() }, { merge: true });
          summary.interviewSlotsMigrated++;
        }
      }
      await slotsBatch.commit();
      console.log(`[Migration] Interview slots migrated: ${summary.interviewSlotsMigrated}`);
    } catch (err: any) {
      summary.errors.push(`Interview slots migration error: ${err.message}`);
    }

    // 3. Migrate Candidate Long-Term Memories
    try {
      const rawMemories = readJsonFile<Record<string, any>>('candidate_memories.json', {});
      const memoryEntries = Object.entries(rawMemories);
      if (memoryEntries.length > 0) {
        const memBatch = writeBatch(db);
        for (const [candId, mem] of memoryEntries) {
          const targetId = mem.candidateId || candId;
          const ref = doc(db, 'candidate_memories', targetId);
          memBatch.set(ref, { ...mem, candidateId: targetId, migratedAt: new Date().toISOString() }, { merge: true });
          summary.candidateMemoriesMigrated++;
        }
        await memBatch.commit();
        console.log(`[Migration] Candidate memories migrated: ${summary.candidateMemoriesMigrated}`);
      }
    } catch (err: any) {
      summary.errors.push(`Candidate memories migration error: ${err.message}`);
    }

    // 4. Migrate Candidate Behavior Reports
    try {
      const rawBehaviors = readJsonFile<Record<string, any[]>>('candidate_behaviors.json', {});
      const behaviorBatches: any[] = [];
      for (const [candId, reports] of Object.entries(rawBehaviors)) {
        if (Array.isArray(reports)) {
          for (const rep of reports) {
            if (rep.id) {
              const ref = doc(db, 'behavior_reports', rep.id);
              behaviorBatches.push({ ref, data: { ...rep, candidateId: rep.candidateId || candId, migratedAt: new Date().toISOString() } });
            }
          }
        }
      }

      if (behaviorBatches.length > 0) {
        const bBatch = writeBatch(db);
        for (const item of behaviorBatches) {
          bBatch.set(item.ref, item.data, { merge: true });
          summary.behaviorReportsMigrated++;
        }
        await bBatch.commit();
        console.log(`[Migration] Behavior reports migrated: ${summary.behaviorReportsMigrated}`);
      }
    } catch (err: any) {
      summary.errors.push(`Behavior reports migration error: ${err.message}`);
    }

    // 5. Migrate Call Logs / Conversations
    try {
      const rawConversations = readJsonFile<Record<string, any>>('conversations_store.json', {});
      const convEntries = Object.entries(rawConversations);
      if (convEntries.length > 0) {
        const convBatch = writeBatch(db);
        for (const [callId, callRecord] of convEntries) {
          const targetId = callRecord.id || callId;
          const ref = doc(db, 'call_logs', targetId);
          convBatch.set(ref, { ...callRecord, id: targetId, migratedAt: new Date().toISOString() }, { merge: true });
          summary.callLogsMigrated++;
        }
        await convBatch.commit();
        console.log(`[Migration] Call logs migrated: ${summary.callLogsMigrated}`);
      }
    } catch (err: any) {
      summary.errors.push(`Call logs migration error: ${err.message}`);
    }

    // 6. Migrate Human Feedback
    try {
      const feedbackList = readJsonFile<any[]>('human_feedback.json', []);
      if (feedbackList.length > 0) {
        const fbBatch = writeBatch(db);
        for (const fb of feedbackList) {
          if (fb.id) {
            const ref = doc(db, 'human_feedback', fb.id);
            fbBatch.set(ref, { ...fb, migratedAt: new Date().toISOString() }, { merge: true });
            summary.humanFeedbackMigrated++;
          }
        }
        await fbBatch.commit();
        console.log(`[Migration] Human feedback records migrated: ${summary.humanFeedbackMigrated}`);
      }
    } catch (err: any) {
      summary.errors.push(`Human feedback migration error: ${err.message}`);
    }

    // 7. Migrate Learning Proposals
    try {
      const proposalsList = readJsonFile<any[]>('learning_proposals.json', []);
      if (proposalsList.length > 0) {
        const propBatch = writeBatch(db);
        for (const prop of proposalsList) {
          if (prop.id) {
            const ref = doc(db, 'learning_proposals', prop.id);
            propBatch.set(ref, { ...prop, migratedAt: new Date().toISOString() }, { merge: true });
            summary.learningProposalsMigrated++;
          }
        }
        await propBatch.commit();
        console.log(`[Migration] Learning proposals migrated: ${summary.learningProposalsMigrated}`);
      }
    } catch (err: any) {
      summary.errors.push(`Learning proposals migration error: ${err.message}`);
    }

    // 8. Migrate Memory Audit Trail
    try {
      const auditList = readJsonFile<any[]>('memory_audit_trail.json', []);
      if (auditList.length > 0) {
        const auditBatch = writeBatch(db);
        for (const audit of auditList) {
          if (audit.id) {
            const ref = doc(db, 'memory_audit_trail', audit.id);
            auditBatch.set(ref, { ...audit, migratedAt: new Date().toISOString() }, { merge: true });
            summary.memoryAuditMigrated++;
          }
        }
        await auditBatch.commit();
        console.log(`[Migration] Memory audit records migrated: ${summary.memoryAuditMigrated}`);
      }
    } catch (err: any) {
      summary.errors.push(`Memory audit migration error: ${err.message}`);
    }

    // 9. Migrate Question Stats
    try {
      const rawQuestions = readJsonFile<Record<string, any>>('question_stats.json', {});
      const qEntries = Object.entries(rawQuestions);
      if (qEntries.length > 0) {
        const qBatch = writeBatch(db);
        for (const [qId, qData] of qEntries) {
          const targetId = qData.questionId || qId;
          const ref = doc(db, 'question_stats', targetId);
          qBatch.set(ref, { ...qData, questionId: targetId, migratedAt: new Date().toISOString() }, { merge: true });
          summary.questionStatsMigrated++;
        }
        await qBatch.commit();
        console.log(`[Migration] Question stats migrated: ${summary.questionStatsMigrated}`);
      }
    } catch (err: any) {
      summary.errors.push(`Question stats migration error: ${err.message}`);
    }

    console.log('[Migration] Migration to Firestore completed successfully!');
    return summary;
  } catch (err: any) {
    console.error('[Migration] Fatal error in JSON to Firestore migration:', err);
    summary.errors.push(`Fatal migration error: ${err.message}`);
    return summary;
  }
}

// Allow CLI direct execution via tsx
if (process.argv[1] && process.argv[1].endsWith('migrateJsonToFirestore.ts')) {
  runJsonToFirestoreMigration()
    .then((res) => {
      console.log('Result:', JSON.stringify(res, null, 2));
      process.exit(0);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
