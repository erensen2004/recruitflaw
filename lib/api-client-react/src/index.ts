// Mock API hooks for demo purposes
import { useMutation, useQuery } from "@tanstack/react-query";

// Mock data
const mockUsers = [
  { id: 1, email: "admin@ats.com", name: "System Admin", role: "admin" as const, companyId: null, companyName: null, isActive: true, createdAt: "2024-01-01" },
  { id: 2, email: "hr@techcorp.com", name: "Sarah HR", role: "client" as const, companyId: 1, companyName: "TechCorp Inc", isActive: true, createdAt: "2024-01-02" },
  { id: 3, email: "vendor@staffingpro.com", name: "Mike Vendor", role: "vendor" as const, companyId: 2, companyName: "StaffingPro LLC", isActive: true, createdAt: "2024-01-03" },
];

const mockCompanies = [
  { id: 1, name: "TechCorp Inc", type: "client" as const, isActive: true, createdAt: "2024-01-01" },
  { id: 2, name: "StaffingPro LLC", type: "vendor" as const, isActive: true, createdAt: "2024-01-02" },
  { id: 3, name: "FinanceHub Ltd", type: "client" as const, isActive: true, createdAt: "2024-01-03" },
];

const mockRoles = [
  { id: 1, title: "Senior React Developer", description: "Build amazing web apps", skills: "React, TypeScript, Node.js", salaryMin: 120000, salaryMax: 160000, location: "San Francisco, CA", employmentType: "full-time" as const, isRemote: true, status: "published" as const, companyId: 1, companyName: "TechCorp Inc", candidateCount: 5, createdAt: "2024-01-15", updatedAt: "2024-01-15" },
  { id: 2, title: "Product Designer", description: "Design user experiences", skills: "Figma, UI/UX, Prototyping", salaryMin: 100000, salaryMax: 140000, location: "New York, NY", employmentType: "full-time" as const, isRemote: false, status: "published" as const, companyId: 1, companyName: "TechCorp Inc", candidateCount: 3, createdAt: "2024-01-16", updatedAt: "2024-01-16" },
  { id: 3, title: "Data Engineer", description: "Build data pipelines", skills: "Python, SQL, Spark", salaryMin: 130000, salaryMax: 170000, location: "Remote", employmentType: "contract" as const, isRemote: true, status: "published" as const, companyId: 3, companyName: "FinanceHub Ltd", candidateCount: 2, createdAt: "2024-01-17", updatedAt: "2024-01-17" },
];

const mockCandidates = [
  { id: 1, firstName: "John", lastName: "Doe", email: "john@example.com", phone: "+1 555-0101", expectedSalary: 145000, status: "interview" as const, roleId: 1, roleTitle: "Senior React Developer", vendorCompanyId: 2, vendorCompanyName: "StaffingPro LLC", submittedAt: "2024-02-01", updatedAt: "2024-02-05", cvUrl: null, tags: "react,senior" },
  { id: 2, firstName: "Jane", lastName: "Smith", email: "jane@example.com", phone: "+1 555-0102", expectedSalary: 135000, status: "screening" as const, roleId: 1, roleTitle: "Senior React Developer", vendorCompanyId: 2, vendorCompanyName: "StaffingPro LLC", submittedAt: "2024-02-02", updatedAt: "2024-02-03", cvUrl: null, tags: "react,typescript" },
  { id: 3, firstName: "Bob", lastName: "Wilson", email: "bob@example.com", phone: "+1 555-0103", expectedSalary: 120000, status: "offer" as const, roleId: 2, roleTitle: "Product Designer", vendorCompanyId: 2, vendorCompanyName: "StaffingPro LLC", submittedAt: "2024-02-03", updatedAt: "2024-02-10", cvUrl: null, tags: "figma,design" },
];

const mockContracts = [
  { id: 1, candidateId: 3, candidateName: "Bob Wilson", roleTitle: "Product Designer", vendorCompanyName: "StaffingPro LLC", startDate: "2024-03-01", endDate: null, dailyRate: 600, isActive: true, createdAt: "2024-02-15" },
];

const mockTimesheets = [
  { id: 1, contractId: 1, candidateName: "Bob Wilson", roleTitle: "Product Designer", month: 3, year: 2024, totalDays: 22, totalAmount: 13200, submittedAt: "2024-04-01" },
];

// Session storage for demo login
let currentUser: typeof mockUsers[0] | null = null;

// Helper to get current user from storage
const getCurrentUserFromStorage = () => {
  const stored = localStorage.getItem("ats_demo_user");
  if (stored) {
    try {
      return JSON.parse(stored);
    } catch {
      return null;
    }
  }
  return null;
};

// Login hook
export const useLogin = (options?: { mutation?: { onSuccess?: (data: any) => void; onError?: () => void } }) => {
  return useMutation({
    mutationFn: async ({ data }: { data: { email: string; password: string } }) => {
      await new Promise(r => setTimeout(r, 500)); // Simulate network delay
      
      const user = mockUsers.find(u => u.email === data.email);
      if (!user) throw new Error("Invalid credentials");
      
      // Simple password check for demo
      const validPasswords: Record<string, string> = {
        "admin@ats.com": "admin123",
        "hr@techcorp.com": "client123",
        "vendor@staffingpro.com": "vendor123"
      };
      
      if (validPasswords[data.email] !== data.password) {
        throw new Error("Invalid credentials");
      }
      
      currentUser = user;
      localStorage.setItem("ats_demo_user", JSON.stringify(user));
      
      return {
        token: "demo-token-" + user.id,
        user: { id: user.id, email: user.email, name: user.name, role: user.role, companyId: user.companyId, companyName: user.companyName }
      };
    },
    onSuccess: options?.mutation?.onSuccess,
    onError: options?.mutation?.onError,
  });
};

// Get current user hook
export const useGetMe = () => {
  return useQuery({
    queryKey: ["me"],
    queryFn: async () => {
      await new Promise(r => setTimeout(r, 200));
      const user = getCurrentUserFromStorage();
      if (!user) throw new Error("Not authenticated");
      return { id: user.id, email: user.email, name: user.name, role: user.role, companyId: user.companyId, companyName: user.companyName };
    },
    retry: false,
  });
};

// Companies hooks
export const useListCompanies = () => {
  return useQuery({
    queryKey: ["companies"],
    queryFn: async () => {
      await new Promise(r => setTimeout(r, 300));
      return mockCompanies;
    },
  });
};

export const useCreateCompany = (options?: any) => {
  return useMutation({
    mutationFn: async ({ data }: { data: { name: string; type: "client" | "vendor" } }) => {
      await new Promise(r => setTimeout(r, 300));
      const newCompany = { id: mockCompanies.length + 1, ...data, isActive: true, createdAt: new Date().toISOString() };
      mockCompanies.push(newCompany);
      return newCompany;
    },
    ...options?.mutation,
  });
};

export const useUpdateCompany = (options?: any) => {
  return useMutation({
    mutationFn: async ({ id, data }: { id: number; data: { name?: string; isActive?: boolean } }) => {
      await new Promise(r => setTimeout(r, 300));
      const company = mockCompanies.find(c => c.id === id);
      if (company) Object.assign(company, data);
      return company;
    },
    ...options?.mutation,
  });
};

// Users hooks
export const useListUsers = () => {
  return useQuery({
    queryKey: ["users"],
    queryFn: async () => {
      await new Promise(r => setTimeout(r, 300));
      return mockUsers;
    },
  });
};

export const useCreateUser = (options?: any) => {
  return useMutation({
    mutationFn: async ({ data }: { data: any }) => {
      await new Promise(r => setTimeout(r, 300));
      const newUser = { id: mockUsers.length + 1, ...data, isActive: true, createdAt: new Date().toISOString() };
      mockUsers.push(newUser);
      return newUser;
    },
    ...options?.mutation,
  });
};

export const useUpdateUser = (options?: any) => {
  return useMutation({
    mutationFn: async ({ id, data }: { id: number; data: any }) => {
      await new Promise(r => setTimeout(r, 300));
      const user = mockUsers.find(u => u.id === id);
      if (user) Object.assign(user, data);
      return user;
    },
    ...options?.mutation,
  });
};

// Roles hooks
export const useListRoles = () => {
  return useQuery({
    queryKey: ["roles"],
    queryFn: async () => {
      await new Promise(r => setTimeout(r, 300));
      return mockRoles;
    },
  });
};

export const useGetRole = (id: number) => {
  return useQuery({
    queryKey: ["role", id],
    queryFn: async () => {
      await new Promise(r => setTimeout(r, 200));
      return mockRoles.find(r => r.id === id);
    },
  });
};

export const useCreateRole = (options?: any) => {
  return useMutation({
    mutationFn: async ({ data }: { data: any }) => {
      await new Promise(r => setTimeout(r, 300));
      const user = getCurrentUserFromStorage();
      const newRole = { 
        id: mockRoles.length + 1, 
        ...data, 
        status: "draft" as const,
        companyId: user?.companyId || 1,
        companyName: user?.companyName || "TechCorp Inc",
        candidateCount: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      mockRoles.push(newRole);
      return newRole;
    },
    ...options?.mutation,
  });
};

export const useUpdateRole = (options?: any) => {
  return useMutation({
    mutationFn: async ({ id, data }: { id: number; data: any }) => {
      await new Promise(r => setTimeout(r, 300));
      const role = mockRoles.find(r => r.id === id);
      if (role) Object.assign(role, data, { updatedAt: new Date().toISOString() });
      return role;
    },
    ...options?.mutation,
  });
};

export const useUpdateRoleStatus = (options?: any) => {
  return useMutation({
    mutationFn: async ({ id, data }: { id: number; data: { status: string } }) => {
      await new Promise(r => setTimeout(r, 300));
      const role = mockRoles.find(r => r.id === id);
      if (role) {
        role.status = data.status as any;
        role.updatedAt = new Date().toISOString();
      }
      return role;
    },
    ...options?.mutation,
  });
};

// Candidates hooks
export const useListCandidates = (params?: { roleId?: number }) => {
  return useQuery({
    queryKey: ["candidates", params],
    queryFn: async () => {
      await new Promise(r => setTimeout(r, 300));
      let candidates = [...mockCandidates];
      if (params?.roleId) {
        candidates = candidates.filter(c => c.roleId === params.roleId);
      }
      return candidates;
    },
  });
};

export const useGetCandidate = (id: number) => {
  return useQuery({
    queryKey: ["candidate", id],
    queryFn: async () => {
      await new Promise(r => setTimeout(r, 200));
      return mockCandidates.find(c => c.id === id);
    },
  });
};

export const useSubmitCandidate = (options?: any) => {
  return useMutation({
    mutationFn: async ({ data }: { data: any }) => {
      await new Promise(r => setTimeout(r, 300));
      const user = getCurrentUserFromStorage();
      const role = mockRoles.find(r => r.id === data.roleId);
      const newCandidate = {
        id: mockCandidates.length + 1,
        ...data,
        status: "submitted" as const,
        roleTitle: role?.title || "Unknown Role",
        vendorCompanyId: user?.companyId || 2,
        vendorCompanyName: user?.companyName || "StaffingPro LLC",
        submittedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      mockCandidates.push(newCandidate);
      return newCandidate;
    },
    ...options?.mutation,
  });
};

export const useUpdateCandidateStatus = (options?: any) => {
  return useMutation({
    mutationFn: async ({ id, data }: { id: number; data: { status: string } }) => {
      await new Promise(r => setTimeout(r, 300));
      const candidate = mockCandidates.find(c => c.id === id);
      if (candidate) {
        candidate.status = data.status as any;
        candidate.updatedAt = new Date().toISOString();
      }
      return candidate;
    },
    ...options?.mutation,
  });
};

// Contracts hooks
export const useListContracts = () => {
  return useQuery({
    queryKey: ["contracts"],
    queryFn: async () => {
      await new Promise(r => setTimeout(r, 300));
      return mockContracts;
    },
  });
};

export const useCreateContract = (options?: any) => {
  return useMutation({
    mutationFn: async ({ data }: { data: any }) => {
      await new Promise(r => setTimeout(r, 300));
      const candidate = mockCandidates.find(c => c.id === data.candidateId);
      const newContract = {
        id: mockContracts.length + 1,
        ...data,
        candidateName: candidate ? `${candidate.firstName} ${candidate.lastName}` : "Unknown",
        roleTitle: candidate?.roleTitle || "Unknown",
        vendorCompanyName: candidate?.vendorCompanyName || "Unknown",
        isActive: true,
        createdAt: new Date().toISOString(),
      };
      mockContracts.push(newContract);
      return newContract;
    },
    ...options?.mutation,
  });
};

// Timesheets hooks
export const useListTimesheets = () => {
  return useQuery({
    queryKey: ["timesheets"],
    queryFn: async () => {
      await new Promise(r => setTimeout(r, 300));
      return mockTimesheets;
    },
  });
};

export const useSubmitTimesheet = (options?: any) => {
  return useMutation({
    mutationFn: async ({ data }: { data: any }) => {
      await new Promise(r => setTimeout(r, 300));
      const contract = mockContracts.find(c => c.id === data.contractId);
      const newTimesheet = {
        id: mockTimesheets.length + 1,
        ...data,
        candidateName: contract?.candidateName || "Unknown",
        roleTitle: contract?.roleTitle || "Unknown",
        totalAmount: data.totalDays * (contract?.dailyRate || 0),
        submittedAt: new Date().toISOString(),
      };
      mockTimesheets.push(newTimesheet);
      return newTimesheet;
    },
    ...options?.mutation,
  });
};

// Notes hooks
export const useListCandidateNotes = (candidateId: number) => {
  return useQuery({
    queryKey: ["notes", candidateId],
    queryFn: async () => {
      await new Promise(r => setTimeout(r, 200));
      return [] as any[];
    },
  });
};

export const useAddCandidateNote = (options?: any) => {
  return useMutation({
    mutationFn: async ({ candidateId, data }: { candidateId: number; data: { content: string } }) => {
      await new Promise(r => setTimeout(r, 200));
      return { id: 1, candidateId, ...data, userId: 1, authorName: "Demo User", createdAt: new Date().toISOString() };
    },
    ...options?.mutation,
  });
};

// Analytics hook
export const useGetAnalytics = () => {
  return useQuery({
    queryKey: ["analytics"],
    queryFn: async () => {
      await new Promise(r => setTimeout(r, 300));
      return {
        totalCandidates: mockCandidates.length,
        totalRoles: mockRoles.length,
        totalCompanies: mockCompanies.length,
        totalUsers: mockUsers.length,
        candidatesByStatus: [
          { status: "submitted", count: 1 },
          { status: "screening", count: 1 },
          { status: "interview", count: 1 },
          { status: "offer", count: 1 },
        ],
        rolesByStatus: [
          { status: "published", count: 3 },
        ],
        topRoles: mockRoles.slice(0, 5).map(r => ({ roleId: r.id, roleTitle: r.title, count: r.candidateCount })),
      };
    },
  });
};

// Storage hooks
export const useGetUploadUrl = (options?: any) => {
  return useMutation({
    mutationFn: async ({ data }: { data: { name: string; size: number; contentType: string } }) => {
      await new Promise(r => setTimeout(r, 200));
      return { uploadURL: "https://example.com/upload", objectPath: "/uploads/" + data.name };
    },
    ...options?.mutation,
  });
};

// Query key exports for cache invalidation
export const getListCompaniesQueryKey = () => ["companies"] as const;
export const getListUsersQueryKey = () => ["users"] as const;
export const getListRolesQueryKey = () => ["roles"] as const;
export const getListCandidatesQueryKey = (params?: { roleId?: number }) => ["candidates", params] as const;
export const getListContractsQueryKey = () => ["contracts"] as const;
export const getListTimesheetsQueryKey = () => ["timesheets"] as const;
export const getGetAnalyticsQueryKey = () => ["analytics"] as const;
export const getGetCandidateQueryKey = (id: number) => ["candidate", id] as const;
export const getGetRoleQueryKey = (id: number) => ["role", id] as const;

// Re-export types
export * from "./generated/api.schemas";
