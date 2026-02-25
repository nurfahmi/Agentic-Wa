const prisma = require('../config/database');

/**
 * Get next duty agent using round-robin (least assignments first)
 */
async function getNextAgent() {
  const agent = await prisma.dutyAgent.findFirst({
    where: { active: true },
    orderBy: [
      { assignmentCount: 'asc' },
      { lastAssignedAt: 'asc' },
    ],
  });

  if (!agent) return null;

  // Increment assignment count
  await prisma.dutyAgent.update({
    where: { id: agent.id },
    data: {
      assignmentCount: { increment: 1 },
      lastAssignedAt: new Date(),
    },
  });

  return agent;
}

module.exports = { getNextAgent };
