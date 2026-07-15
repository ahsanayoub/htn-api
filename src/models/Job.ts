export interface HTNJob {

    source: string;
    sourceJobId: string;

    title: string;

    company: string;

    description: string;

    employmentType: string;

    workHours: string;

    locationType: string;

    skills: string[];

    applyUrl: string;

    postedDate: string;

    validThrough: string;

    remote: boolean;

}