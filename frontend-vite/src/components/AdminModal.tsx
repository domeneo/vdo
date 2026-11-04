import React, { useState, useEffect } from "react";
import {
  Users,
  Folder,
  Eye,
  EyeOff,
  Plus,
  Trash2,
  X,
  Shield,
  RefreshCw,
  Settings,
  HardDrive,
  Check,
  FolderPlus,
} from "lucide-react";

interface User {
  id: number;
  username: string;
  is_admin: boolean;
}

interface FolderItem {
  id: number;
  name: string;
  path: string;
  is_hidden_for_normal_users: boolean;
}

interface AdditionalFolder {
  id: number;
  name: string;
  path: string;
  excluded_folders: string;
}

interface AdminModalProps {
  isOpen: boolean;
  onClose: () => void;
  getBackendUrl: () => string;
}

export const AdminModal: React.FC<AdminModalProps> = ({ isOpen, onClose, getBackendUrl }) => {
  const [activeTab, setActiveTab] = useState<"folders" | "additional" | "users" | "settings">("folders");
  const [users, setUsers] = useState<User[]>([]);
  const [folders, setFolders] = useState<FolderItem[]>([]);
  const [additionalFolders, setAdditionalFolders] = useState<AdditionalFolder[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  // Create User State
  const [newUsername, setNewUsername] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newIsAdmin, setNewIsAdmin] = useState(false);
  const [creatingUser, setCreatingUser] = useState(false);

  // Additional Folder Form State
  const [addFolderName, setAddFolderName] = useState("");
  const [addFolderPath, setAddFolderPath] = useState("");
  const [addFolderExclude, setAddFolderExclude] = useState("");
  const [addingFolder, setAddingFolder] = useState(false);

  // Settings State (Video Root Path & Exclude list)
  const [videoRootPath, setVideoRootPath] = useState("");
  const [excludedFolders, setExcludedFolders] = useState("");
  const [savingSettings, setSavingSettings] = useState(false);

  useEffect(() => {
    if (isOpen) {
      loadData();
    }
  }, [isOpen]);

  const getAuthHeaders = (): Record<string, string> => {
    const token = localStorage.getItem("vdo_auth_token");
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }
    return headers;
  };

  const loadData = async () => {
    setLoading(true);
    setError("");
    try {
      const backend = getBackendUrl();
      const headers = getAuthHeaders();

      // 1. Load System Settings (Root path & Exclude)
      const resSettings = await fetch(`${backend}/api/admin/settings`, {
        headers,
        credentials: "include",
      });
      if (resSettings.ok) {
        const s = await resSettings.json();
        setVideoRootPath(s.video_root_path || "");
        setExcludedFolders(s.excluded_folders || "");
      }

      // 2. Load Additional Folders
      const resAdd = await fetch(`${backend}/api/admin/additional-folders`, {
        headers,
        credentials: "include",
      });
      if (resAdd.ok) {
        const a = await resAdd.json();
        setAdditionalFolders(a);
      }

      // 3. Load users
      const resUsers = await fetch(`${backend}/api/users`, {
        headers,
        credentials: "include",
      });
      if (resUsers.ok) {
        const u = await resUsers.json();
        setUsers(u);
      }

      // 4. Load root filesystem folders & sync with DB
      const resFs = await fetch(`${backend}/api/fs`, {
        headers,
        credentials: "include",
      });
      if (resFs.ok) {
        const fsItems = await resFs.json();
        const rootDirs = fsItems.filter((i: any) => i.is_dir).map((d: any) => ({
          name: d.name,
          path: d.relative_path,
        }));
        if (rootDirs.length > 0) {
          await fetch(`${backend}/api/admin/folders/sync`, {
            method: "POST",
            headers,
            credentials: "include",
            body: JSON.stringify(rootDirs),
          });
        }
      }

      // 5. Load folders with visibility status
      const resFolders = await fetch(`${backend}/api/admin/folders`, {
        headers,
        credentials: "include",
      });
      if (resFolders.ok) {
        const f = await resFolders.json();
        setFolders(f);
      }
    } catch (e: any) {
      setError(e.message || "Failed to load admin data");
    } finally {
      setLoading(false);
    }
  };

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingSettings(true);
    setError("");
    setSuccess("");
    try {
      const backend = getBackendUrl();
      const res = await fetch(`${backend}/api/admin/settings`, {
        method: "POST",
        headers: getAuthHeaders(),
        credentials: "include",
        body: JSON.stringify({
          video_root_path: videoRootPath,
          excluded_folders: excludedFolders,
        }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setSuccess(data.message || "บันทึกการตั้งค่าสำเร็จ!");
        loadData();
      } else {
        setError(data.message || "บันทึกการตั้งค่าไม่สำเร็จ");
      }
    } catch {
      setError("เกิดข้อผิดพลาดในการเชื่อมต่อเซิร์ฟเวอร์");
    } finally {
      setSavingSettings(false);
    }
  };

  const handleAddAdditionalFolder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!addFolderName.trim() || !addFolderPath.trim()) return;
    setAddingFolder(true);
    setError("");
    setSuccess("");
    try {
      const backend = getBackendUrl();
      const res = await fetch(`${backend}/api/admin/additional-folders`, {
        method: "POST",
        headers: getAuthHeaders(),
        credentials: "include",
        body: JSON.stringify({
          name: addFolderName.trim(),
          path: addFolderPath.trim(),
          excluded_folders: addFolderExclude.trim(),
        }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setSuccess(`เพิ่มโฟลเดอร์ '${addFolderName}' สำเร็จ!`);
        setAddFolderName("");
        setAddFolderPath("");
        setAddFolderExclude("");
        loadData();
      } else {
        setError(data.message || "ไม่สามารถเพิ่มโฟลเดอร์ได้");
      }
    } catch {
      setError("เกิดข้อผิดพลาดในการเชื่อมต่อเซิร์ฟเวอร์");
    } finally {
      setAddingFolder(false);
    }
  };

  const handleDeleteAdditionalFolder = async (id: number, name: string) => {
    if (!confirm(`คุณต้องการลบโฟลเดอร์ '${name}' ออกจากระบบใช่หรือไม่?`)) return;
    try {
      const backend = getBackendUrl();
      const res = await fetch(`${backend}/api/admin/additional-folders/${id}`, {
        method: "DELETE",
        headers: getAuthHeaders(),
        credentials: "include",
      });
      if (res.ok) {
        loadData();
      }
    } catch (e: any) {
      setError(e.message);
    }
  };

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newUsername || !newPassword) return;
    setCreatingUser(true);
    setError("");
    setSuccess("");
    try {
      const backend = getBackendUrl();
      const res = await fetch(`${backend}/api/users`, {
        method: "POST",
        headers: getAuthHeaders(),
        credentials: "include",
        body: JSON.stringify({
          username: newUsername,
          password: newPassword,
          is_admin: newIsAdmin,
        }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setSuccess(`สร้างผู้ใช้ ${newUsername} สำเร็จ!`);
        setNewUsername("");
        setNewPassword("");
        setNewIsAdmin(false);
        loadData();
      } else {
        setError(data.message || "ไม่สามารถสร้างผู้ใช้ได้");
      }
    } catch (err: any) {
      setError(err?.message || "เกิดข้อผิดพลาดในการเชื่อมต่อ");
    } finally {
      setCreatingUser(false);
    }
  };

  const handleDeleteUser = async (userId: number, name: string) => {
    if (!confirm(`คุณต้องการลบผู้ใช้ ${name} ใช่หรือไม่?`)) return;
    try {
      const backend = getBackendUrl();
      const res = await fetch(`${backend}/api/users/${userId}`, {
        method: "DELETE",
        headers: getAuthHeaders(),
        credentials: "include",
      });
      if (res.ok) {
        loadData();
      }
    } catch (e: any) {
      setError(e.message);
    }
  };

  const handleToggleFolder = async (folder: FolderItem) => {
    try {
      const backend = getBackendUrl();
      const endpoint = folder.is_hidden_for_normal_users
        ? `${backend}/api/admin/folders/${folder.id}/show`
        : `${backend}/api/admin/folders/${folder.id}/hide`;

      const res = await fetch(endpoint, {
        method: "POST",
        headers: getAuthHeaders(),
        credentials: "include",
      });
      if (res.ok) {
        setFolders(
          folders.map((f) =>
            f.id === folder.id
              ? { ...f, is_hidden_for_normal_users: !f.is_hidden_for_normal_users }
              : f
          )
        );
      }
    } catch (e: any) {
      setError(e.message);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fade-in">
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl w-full max-w-4xl overflow-hidden shadow-2xl flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-rose-500/10 text-rose-500 rounded-lg">
              <Shield className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-zinc-100">จัดการระบบ (Admin)</h2>
              <p className="text-xs text-zinc-400">จัดการโฟลเดอร์แชร์เพิ่มเติม, Exclude โฟลเดอร์, และผู้ใช้งาน</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 rounded-lg transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab Buttons */}
        <div className="flex border-b border-zinc-800 bg-zinc-950/40 px-6 pt-3 gap-4 overflow-x-auto">
          <button
            onClick={() => setActiveTab("folders")}
            className={`pb-3 text-sm font-semibold flex items-center gap-2 border-b-2 transition shrink-0 cursor-pointer ${
              activeTab === "folders"
                ? "border-rose-500 text-rose-400"
                : "border-transparent text-zinc-400 hover:text-zinc-200"
            }`}
          >
            <Folder className="w-4 h-4" />
            ซ่อนโฟลเดอร์ ({folders.length})
          </button>
          <button
            onClick={() => setActiveTab("additional")}
            className={`pb-3 text-sm font-semibold flex items-center gap-2 border-b-2 transition shrink-0 cursor-pointer ${
              activeTab === "additional"
                ? "border-rose-500 text-rose-400"
                : "border-transparent text-zinc-400 hover:text-zinc-200"
            }`}
          >
            <FolderPlus className="w-4 h-4" />
            โฟลเดอร์เพิ่มเติม / Network Share ({additionalFolders.length})
          </button>
          <button
            onClick={() => setActiveTab("settings")}
            className={`pb-3 text-sm font-semibold flex items-center gap-2 border-b-2 transition shrink-0 cursor-pointer ${
              activeTab === "settings"
                ? "border-rose-500 text-rose-400"
                : "border-transparent text-zinc-400 hover:text-zinc-200"
            }`}
          >
            <Settings className="w-4 h-4" />
            Primary Root Path
          </button>
          <button
            onClick={() => setActiveTab("users")}
            className={`pb-3 text-sm font-semibold flex items-center gap-2 border-b-2 transition shrink-0 cursor-pointer ${
              activeTab === "users"
                ? "border-rose-500 text-rose-400"
                : "border-transparent text-zinc-400 hover:text-zinc-200"
            }`}
          >
            <Users className="w-4 h-4" />
            ผู้ใช้งาน ({users.length})
          </button>
        </div>

        {/* Status Alerts */}
        {error && (
          <div className="mx-6 mt-4 p-3 bg-red-950/60 border border-red-800 text-red-200 text-sm rounded-xl">
            {error}
          </div>
        )}
        {success && (
          <div className="mx-6 mt-4 p-3 bg-emerald-950/60 border border-emerald-800 text-emerald-200 text-sm rounded-xl flex items-center gap-2">
            <Check className="w-4 h-4" />
            <span>{success}</span>
          </div>
        )}

        {/* Content Body */}
        <div className="p-6 overflow-y-auto space-y-6 flex-1">
          {/* TAB 1: Additional Folders (Table & Add form) */}
          {activeTab === "additional" && (
            <div className="space-y-6">
              {/* Add form */}
              <form
                onSubmit={handleAddAdditionalFolder}
                className="p-4 bg-zinc-950/60 border border-zinc-800 rounded-xl space-y-3"
              >
                <div className="flex items-center gap-2 text-rose-400 font-semibold text-xs uppercase tracking-wider">
                  <Plus className="w-4 h-4" />
                  <span>เพิ่มโฟลเดอร์แชร์ใหม่ (Addition Folder / UNC Share)</span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-[11px] text-zinc-400 mb-1">ชื่อโฟลเดอร์ (แสดงในหน้าเว็บ)</label>
                    <input
                      type="text"
                      placeholder="เช่น bit, external_movies"
                      value={addFolderName}
                      onChange={(e) => setAddFolderName(e.target.value)}
                      className="w-full px-3 py-2 bg-zinc-900 border border-zinc-700 rounded-lg text-sm text-zinc-100 focus:outline-none focus:border-rose-500"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-zinc-400 mb-1">Path โฟลเดอร์จริง / UNC</label>
                    <input
                      type="text"
                      placeholder="เช่น \\192.168.0.13\bit หรือ D:\Videos"
                      value={addFolderPath}
                      onChange={(e) => setAddFolderPath(e.target.value)}
                      className="w-full px-3 py-2 bg-zinc-900 border border-zinc-700 rounded-lg text-sm text-zinc-100 font-mono focus:outline-none focus:border-rose-500"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-zinc-400 mb-1">Exclude (level บนสุด คั่นด้วย comma)</label>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        placeholder="เช่น PIC, Temp, $RECYCLE.BIN"
                        value={addFolderExclude}
                        onChange={(e) => setAddFolderExclude(e.target.value)}
                        className="w-full px-3 py-2 bg-zinc-900 border border-zinc-700 rounded-lg text-sm text-zinc-100 font-mono focus:outline-none focus:border-rose-500"
                      />
                      <button
                        type="submit"
                        disabled={addingFolder}
                        className="px-4 py-2 bg-rose-600 hover:bg-rose-500 text-white rounded-lg text-xs font-semibold transition shrink-0 disabled:opacity-50 cursor-pointer shadow-md shadow-rose-600/20"
                      >
                        {addingFolder ? "กำลังตรวจ..." : "เพิ่ม"}
                      </button>
                    </div>
                  </div>
                </div>
              </form>

              {/* Table of Additional Folders */}
              <div className="overflow-x-auto border border-zinc-800 rounded-xl">
                <table className="w-full text-left text-sm">
                  <thead className="bg-zinc-950/80 text-zinc-400 text-xs uppercase border-b border-zinc-800">
                    <tr>
                      <th className="py-2.5 px-4 font-semibold">ชื่อโฟลเดอร์</th>
                      <th className="py-2.5 px-4 font-semibold">Path โฟลเดอร์จริง / แชร์</th>
                      <th className="py-2.5 px-4 font-semibold">Exclude (Level บนสุด)</th>
                      <th className="py-2.5 px-4 font-semibold text-right">การจัดการ</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-800 text-zinc-200">
                    {additionalFolders.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="py-8 text-center text-zinc-500 text-xs">
                          ยังไม่มีโฟลเดอร์เพิ่มเติม (ใช้ Primary Root เป็นหลัก)
                        </td>
                      </tr>
                    ) : (
                      additionalFolders.map((af) => (
                        <tr key={af.id} className="hover:bg-zinc-800/40 transition">
                          <td className="py-3 px-4 font-medium flex items-center gap-2">
                            <FolderPlus className="w-4 h-4 text-rose-500 shrink-0" />
                            <span>{af.name}</span>
                          </td>
                          <td className="py-3 px-4 font-mono text-xs text-zinc-300">{af.path}</td>
                          <td className="py-3 px-4">
                            {af.excluded_folders ? (
                              <span className="font-mono text-xs text-amber-400/90 bg-amber-500/10 px-2 py-0.5 rounded border border-amber-500/20">
                                {af.excluded_folders}
                              </span>
                            ) : (
                              <span className="text-zinc-600 text-xs">-</span>
                            )}
                          </td>
                          <td className="py-3 px-4 text-right">
                            <button
                              onClick={() => handleDeleteAdditionalFolder(af.id, af.name)}
                              className="p-1.5 text-zinc-500 hover:text-red-400 hover:bg-red-950/40 rounded-lg transition cursor-pointer"
                              title="ลบโฟลเดอร์"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* TAB 2: Settings (Primary Root) */}
          {activeTab === "settings" && (
            <form onSubmit={handleSaveSettings} className="space-y-5">
              <div className="p-4 bg-zinc-950/60 border border-zinc-800 rounded-xl space-y-4">
                <div className="flex items-center gap-2 text-rose-400 font-semibold text-sm">
                  <HardDrive className="w-4 h-4" />
                  <span>ตำแหน่งโฟลเดอร์หนังหลัก (Primary Video Root Path)</span>
                </div>
                <div>
                  <label className="block text-xs text-zinc-400 mb-1.5">
                    พาธโฟลเดอร์หลัก เช่น <span className="font-mono text-zinc-300">E:\plex</span>
                  </label>
                  <input
                    type="text"
                    value={videoRootPath}
                    onChange={(e) => setVideoRootPath(e.target.value)}
                    placeholder="เช่น E:\plex"
                    className="w-full px-3.5 py-2.5 bg-zinc-900 border border-zinc-700 rounded-xl text-sm text-zinc-100 font-mono focus:outline-none focus:border-rose-500"
                  />
                </div>
              </div>

              <div className="p-4 bg-zinc-950/60 border border-zinc-800 rounded-xl space-y-4">
                <div className="flex items-center gap-2 text-amber-400 font-semibold text-sm">
                  <EyeOff className="w-4 h-4" />
                  <span>Exclude Folders ใน Root หลัก</span>
                </div>
                <div>
                  <label className="block text-xs text-zinc-400 mb-1.5">
                    ชื่อโฟลเดอร์ชั้นบนสุดที่ต้องการตัดทิ้ง คั่นด้วย comma
                  </label>
                  <input
                    type="text"
                    value={excludedFolders}
                    onChange={(e) => setExcludedFolders(e.target.value)}
                    placeholder="เช่น PIC, Temp, $RECYCLE.BIN"
                    className="w-full px-3.5 py-2.5 bg-zinc-900 border border-zinc-700 rounded-xl text-sm text-zinc-100 font-mono focus:outline-none focus:border-rose-500"
                  />
                </div>
              </div>

              <div className="flex justify-end pt-2">
                <button
                  type="submit"
                  disabled={savingSettings}
                  className="px-6 py-2.5 bg-rose-600 hover:bg-rose-500 text-white rounded-xl text-sm font-semibold transition flex items-center gap-2 cursor-pointer disabled:opacity-50 shadow-lg shadow-rose-600/20"
                >
                  {savingSettings ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                  <span>{savingSettings ? "กำลังบันทึก..." : "บันทึกการตั้งค่า"}</span>
                </button>
              </div>
            </form>
          )}

          {/* TAB 3: Hide Folders */}
          {activeTab === "folders" && (
            <div className="space-y-4">
              <div className="flex items-center justify-between text-xs text-zinc-400 bg-zinc-950/60 p-3 rounded-xl border border-zinc-800/80">
                <span>📁 โฟลเดอร์ที่ถูกตั้งเป็น "ซ่อน" จะไม่ปรากฏในหน้าเว็บสำหรับผู้ใช้ทั่วไป (บันทึกลง SQLite)</span>
                <button
                  onClick={loadData}
                  className="flex items-center gap-1 hover:text-zinc-200 font-medium cursor-pointer"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
                  รีเฟรช
                </button>
              </div>

              {folders.length === 0 ? (
                <div className="text-center py-10 text-zinc-500 text-sm">
                  {loading ? "กำลังโหลดข้อมูลโฟลเดอร์..." : "ไม่พบโฟลเดอร์ในระบบ"}
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-2.5">
                  {folders.map((f) => (
                    <div
                      key={f.id}
                      className={`flex items-center justify-between p-3.5 rounded-xl border transition ${
                        f.is_hidden_for_normal_users
                          ? "bg-zinc-950/40 border-amber-500/30 text-zinc-400"
                          : "bg-zinc-950/80 border-zinc-800 text-zinc-200"
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <Folder
                          className={`w-5 h-5 ${
                            f.is_hidden_for_normal_users ? "text-amber-500/70" : "text-rose-500"
                          }`}
                        />
                        <div>
                          <p className="font-medium text-sm text-zinc-100">{f.name}</p>
                          <p className="text-xs text-zinc-500 font-mono">{f.path || f.name}</p>
                        </div>
                      </div>

                      <button
                        onClick={() => handleToggleFolder(f)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer ${
                          f.is_hidden_for_normal_users
                            ? "bg-amber-500/10 text-amber-400 border border-amber-500/30 hover:bg-amber-500/20"
                            : "bg-zinc-800 text-zinc-300 border border-zinc-700 hover:bg-zinc-700"
                        }`}
                      >
                        {f.is_hidden_for_normal_users ? (
                          <>
                            <EyeOff className="w-3.5 h-3.5" />
                            <span>ซ่อนอยู่ (คลิกเพื่อแสดง)</span>
                          </>
                        ) : (
                          <>
                            <Eye className="w-3.5 h-3.5 text-emerald-400" />
                            <span>แสดงปกติ (คลิกเพื่อซ่อน)</span>
                          </>
                        )}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* TAB 4: Users */}
          {activeTab === "users" && (
            <div className="space-y-6">
              {/* Add User Form */}
              <form
                onSubmit={handleCreateUser}
                className="p-4 bg-zinc-950/60 border border-zinc-800 rounded-xl space-y-3"
              >
                <h3 className="text-xs font-bold text-zinc-300 uppercase tracking-wider flex items-center gap-1.5">
                  <Plus className="w-3.5 h-3.5 text-rose-500" />
                  เพิ่มผู้ใช้ใหม่ใน SQLite
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <input
                    type="text"
                    placeholder="Username"
                    value={newUsername}
                    onChange={(e) => setNewUsername(e.target.value)}
                    className="px-3 py-2 bg-zinc-900 border border-zinc-700 rounded-lg text-sm text-zinc-100 focus:outline-none focus:border-rose-500"
                    required
                  />
                  <input
                    type="password"
                    placeholder="Password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    className="px-3 py-2 bg-zinc-900 border border-zinc-700 rounded-lg text-sm text-zinc-100 focus:outline-none focus:border-rose-500"
                    required
                  />
                  <div className="flex items-center justify-between gap-2">
                    <label className="flex items-center gap-2 text-xs text-zinc-300 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={newIsAdmin}
                        onChange={(e) => setNewIsAdmin(e.target.checked)}
                        className="rounded bg-zinc-900 border-zinc-700 text-rose-500 focus:ring-0"
                      />
                      <span>สิทธิ์ Admin</span>
                    </label>
                    <button
                      type="submit"
                      disabled={creatingUser}
                      className="px-4 py-2 bg-rose-600 hover:bg-rose-500 text-white rounded-lg text-xs font-semibold transition disabled:opacity-50 cursor-pointer"
                    >
                      {creatingUser ? "กำลังบันทึก..." : "สร้าง User"}
                    </button>
                  </div>
                </div>
              </form>

              {/* Users Table */}
              <div className="overflow-x-auto border border-zinc-800 rounded-xl">
                <table className="w-full text-left text-sm">
                  <thead className="bg-zinc-950/80 text-zinc-400 text-xs uppercase border-b border-zinc-800">
                    <tr>
                      <th className="py-2.5 px-4 font-semibold">ID</th>
                      <th className="py-2.5 px-4 font-semibold">Username</th>
                      <th className="py-2.5 px-4 font-semibold">ระดับสิทธิ์</th>
                      <th className="py-2.5 px-4 font-semibold text-right">การจัดการ</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-800 text-zinc-200">
                    {users.map((u) => (
                      <tr key={u.id} className="hover:bg-zinc-800/40 transition">
                        <td className="py-3 px-4 font-mono text-zinc-500 text-xs">{u.id}</td>
                        <td className="py-3 px-4 font-medium">{u.username}</td>
                        <td className="py-3 px-4">
                          {u.is_admin ? (
                            <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-rose-500/10 text-rose-400 border border-rose-500/20">
                              Admin
                            </span>
                          ) : (
                            <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-zinc-800 text-zinc-400 border border-zinc-700">
                              ผู้ใช้ทั่วไป
                            </span>
                          )}
                        </td>
                        <td className="py-3 px-4 text-right">
                          <button
                            onClick={() => handleDeleteUser(u.id, u.username)}
                            className="p-1.5 text-zinc-500 hover:text-red-400 hover:bg-red-950/40 rounded-lg transition cursor-pointer"
                            title="ลบผู้ใช้"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
