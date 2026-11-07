import Term from '../models/Term.js';
import Year from '../models/Year.js';

// The academic year a newly-enrolled student belongs to, absent an explicit
// yearId — whichever Term is currently marked active.
export const resolveCurrentYearId = async () => {
  const activeTerm = await Term.findOne({ status: 'active' }).sort({ startDate: -1, createdAt: -1 });
  if (activeTerm?.academicYearId) return activeTerm.academicYearId.toString();
  // No term set up yet: the newest school year, so enrolment still has a home.
  const latestYear = await Year.findOne().sort({ createdAt: -1 }).select('_id').lean();
  return latestYear ? latestYear._id.toString() : null;
};
