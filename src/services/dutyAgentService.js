const prisma = require('../config/database');
const logger = require('../utils/logger');

/**
 * Check if current time is within agent's shift window.
 * If agent has no shift defined, they're always available.
 */
function isWithinShift(agent) {
  if (!agent.shiftStart || !agent.shiftEnd) return true;

  const now = new Date();
  const currentMinutes = now.getHours() * 60 + now.getMinutes();

  const [startH, startM] = agent.shiftStart.split(':').map(Number);
  const [endH, endM] = agent.shiftEnd.split(':').map(Number);
  const shiftStartMin = startH * 60 + startM;
  const shiftEndMin = endH * 60 + endM;

  // Handle overnight shifts (e.g., 22:00 - 06:00)
  if (shiftEndMin < shiftStartMin) {
    return currentMinutes >= shiftStartMin || currentMinutes < shiftEndMin;
  }

  return currentMinutes >= shiftStartMin && currentMinutes < shiftEndMin;
}

/**
 * Check if date is today in Malaysia time (UTC+8), reset todayCount if not.
 */
function isToday(date) {
  if (!date) return false;
  const MY_TZ = 'Asia/Kuala_Lumpur';
  const nowMY = new Date().toLocaleDateString('en-CA', { timeZone: MY_TZ });
  const dateMY = new Date(date).toLocaleDateString('en-CA', { timeZone: MY_TZ });
  return nowMY === dateMY;
}

/**
 * Tiered Weighted Round-Robin Algorithm
 *
 * How it works (example: Basic=1, Pro=2, Platinum=3, Ultra=4):
 *
 * WEIGHTED ROUND (first round):
 *   Phase 1: All agents get 1 job each      → B(1) P(1) L(1) U(1)
 *   Phase 2: Tier>=2 agents get 1 more each  → B(1) P(2) L(2) U(2)
 *   Phase 3: Tier>=3 agents get 1 more each  → B(1) P(2) L(3) U(3)
 *   Phase 4: Tier>=4 agents get 1 more each  → B(1) P(2) L(3) U(4)
 *
 * EVEN ROUND (after weighted round completes):
 *   All agents get jobs evenly: 1-1-1-1
 *
 * The algorithm uses "level filling": find the minimum todayCount
 * among agents who still have quota, then pick from those agents.
 */
async function getNextAgent() {
  // 1. Get all active agents with their tier
  const activeAgents = await prisma.dutyAgent.findMany({
    where: { active: true },
    include: { tier: true },
  });

  if (!activeAgents.length) return null;

  // 2. Filter by shift schedule
  let agents = activeAgents.filter(isWithinShift);
  if (agents.length === 0) agents = activeAgents; // fallback

  // 3. Reset todayCount for agents whose lastCountDate is not today
  const resetPromises = [];
  for (const agent of agents) {
    if (!isToday(agent.lastCountDate)) {
      agent.todayCount = 0;
      resetPromises.push(
        prisma.dutyAgent.update({
          where: { id: agent.id },
          data: { todayCount: 0, lastCountDate: new Date() },
        })
      );
    }
  }
  if (resetPromises.length > 0) await Promise.all(resetPromises);

  // 4. Resolve tier weight for each agent (default weight = 1 if no tier assigned)
  const agentsWithWeight = agents.map(a => ({
    ...a,
    weight: a.tier?.weight || 1,
  }));

  // 5. Apply tiered round-robin
  const chosen = pickNextAgent(agentsWithWeight);
  if (!chosen) return null;

  // 6. Update counts
  await prisma.dutyAgent.update({
    where: { id: chosen.id },
    data: {
      assignmentCount: { increment: 1 },
      todayCount: { increment: 1 },
      lastAssignedAt: new Date(),
      lastCountDate: new Date(),
    },
  });

  return chosen;
}

/**
 * Core selection logic:
 * 1. Find agents who still have quota (todayCount < weight) → "weighted round"
 * 2. If all agents have met their quota → "even round" (standard round-robin)
 */
function pickNextAgent(agents) {
  // Agents with remaining quota in the weighted round
  const withQuota = agents.filter(a => a.todayCount < a.weight);

  if (withQuota.length > 0) {
    // WEIGHTED ROUND: level-filling approach
    // Find the minimum todayCount among agents with remaining quota
    const minCount = Math.min(...withQuota.map(a => a.todayCount));

    // Pick agents at this level (they need to be filled up first)
    const candidates = withQuota.filter(a => a.todayCount === minCount);

    // Among candidates at same level, sort by:
    // 1. Lowest total assignmentCount (fairness)
    // 2. Oldest lastAssignedAt (round-robin)
    candidates.sort((a, b) => {
      if (a.assignmentCount !== b.assignmentCount) return a.assignmentCount - b.assignmentCount;
      const aTime = a.lastAssignedAt ? new Date(a.lastAssignedAt).getTime() : 0;
      const bTime = b.lastAssignedAt ? new Date(b.lastAssignedAt).getTime() : 0;
      return aTime - bTime;
    });

    return candidates[0];
  }

  // EVEN ROUND: all agents have met their tier quota
  // Standard round-robin — lowest todayCount first
  const sorted = [...agents].sort((a, b) => {
    if (a.todayCount !== b.todayCount) return a.todayCount - b.todayCount;
    if (a.assignmentCount !== b.assignmentCount) return a.assignmentCount - b.assignmentCount;
    const aTime = a.lastAssignedAt ? new Date(a.lastAssignedAt).getTime() : 0;
    const bTime = b.lastAssignedAt ? new Date(b.lastAssignedAt).getTime() : 0;
    return aTime - bTime;
  });

  return sorted[0];
}

module.exports = { getNextAgent };
