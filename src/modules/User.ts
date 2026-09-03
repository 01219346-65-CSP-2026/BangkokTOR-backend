import { Schema, model, Document, Types } from 'mongoose';

export interface IUser extends Document {
  google_id?: string;
  email: string;
  role: 'admin' | 'client' | 'agency'; //replaces user_types table
  profile?: {                          //replaces user_profiles table
    description?: string;
    budget_min?: number;
    budget_max?: number;
    team_size?: number;
    tech_stacks: Array<{               //replaces user_tech_stacks join table
      tech_stack_id: Types.ObjectId; 
      years_experience?: number;
    }>;
  };
  created_at: Date;
}

const userSchema = new Schema<IUser>({
  google_id: { type: String, unique: true, sparse: true },
  email: { type: String, required: true, unique: true },
  role: { 
    type: String, 
    enum: ['admin', 'client', 'agency'], 
    default: 'client' 
  },
  profile: {
    description: String,
    budget_min: Number,
    budget_max: Number,
    team_size: Number,
    tech_stacks: [{
      //builds the relationship to the TechStack 
      tech_stack_id: { type: Schema.Types.ObjectId, ref: 'TechStack' },
      years_experience: Number
    }]
  },
  created_at: { type: Date, default: Date.now }
});

export const User = model<IUser>('User', userSchema);