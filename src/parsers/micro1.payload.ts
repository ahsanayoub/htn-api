export interface Micro1JobPayload {
    client_job_id: string;
  
    job_role_name: string;
  
    role_type: string;
  
    domain_slug: string;
  
    job_status: string;
  
    no_of_openings: number;
  
    referral_reward_amount: string;
  
    ideal_monthly_salary_min: number | null;
  
    ideal_monthly_salary_max: number | null;
  
    ideal_yearly_compensation: number | null;
  
    ideal_hourly_rate: {
      min: number;
      max: number;
    } | null;
  
    required_skills: string[];
  
    client_details: {
      client_id: string;
  
      client_name: string;
  
      user_image: string;
    };
  
    job_qualifying_question_list: Micro1ScreeningQuestion[];
  
    create_datetime: string;
  
    location_name: string;
  
    location_type: string | null;
  }
  
  export interface Micro1ScreeningQuestion {
    job_screening_question_id: string;
  
    question_text: string;
  
    answer_type: string;
  
    choice_options: string[] | null;
  
    placeholder_value: string | null;
  }