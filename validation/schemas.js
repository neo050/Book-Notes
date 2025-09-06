import { z } from 'zod';

export const UpdateBookSchema = z.object({
  title: z.string().min(1).optional(),
  authors: z.array(z.string().min(1)).optional(),
  description: z.string().min(1).optional(),
  subjects: z.array(z.string().min(1)).optional(),
  languages: z.array(z.string().min(2)).optional(),
  introduction: z.string().min(1).optional(),
  notes: z.string().min(1).optional(),
  rating: z.number().int().min(0).max(5).optional(),
  end_date: z.any().optional(),
}).refine(obj => Object.keys(obj).some(k => obj[k] !== undefined), {
  message: 'At least one field must be provided',
});

