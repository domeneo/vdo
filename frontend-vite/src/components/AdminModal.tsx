import React, { useState, useEffect } from "react";
import {
  Users,
  Plus,
  Trash2,
  X,
  Shield,
  Check,
  FolderPlus,
  Pencil,
  RefreshCw,
} from "lucide-react";

interface User {
  id: number;
  username: string;
  is_admin: boolean;
}

interface AdditionalFolder {
  id: number;
  name: string;
  path: string;
  excluded_folders: string;
  hidden_for_normal_users: string;
}

interface AdminModalProps {
  isOpen: boolean;
  onClose: () => void;
  getBackendUrl: () => string;
}

export const AdminModal: React.FC<AdminModalProps> = ({ isOpen, onClose, getBackendUrl }) => {
  const [activeTab, setActiveTab] = useState<"folders" | "users">("folders");
  const [users, setUsers] = useState<User[]>([]);
  const [additionalFolders, setAdditionalFolders] = useState<AdditionalFolder[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  // Create User State
  const [newUsername, setNewUsername] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newIsAdmin, setNewIsAdmin] = useState(false);
  const [creatingUser, setCreatingUser] = useState(false);

  // Folder Form State
  const [editingFolderId, setEditingFolderId] = useState<number | null>(null);
  const [addFolderName, setAddFolderName] = useState("");
  const [addFolderPath, setAddFolderPath] = useState("");
  const [addFolderExclude, setAddFolderExclude] = useState("");
  const [addFolderHidden, setAddFolderHidden] = useState("");
  const [addingFolder, setAddingFolder] = useState(false);

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

      // 1. Load Folders
      const resAdd = await fetch(`${backend}/api/admin/additional-folders`, {
        headers,
        credentials: "include",
      });
      if (resAdd.ok) {
        const a = await resAdd.json();
        setAdditionalFolders(a);
      }

      // 2. Load users
      const resUsers = await fetch(`${backend}/api/users`, {
        headers,
        credentials: "include",
      });
      if (resUsers.ok) {
        const u = await resUsers.json();
        setUsers(u);
      }
    } catch (e: any) {
      setError(e.message || "Failed to load admin data");
    } finally {
      setLoading(false);
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
      const isEditing = editingFolderId !== null;
      const url = isEditing
        ? `${backend}/api/admin/additional-folders/${editingFolderId}`
        : `${backend}/api/admin/additional-folders`;
      const method = isEditing ? "PUT" : "POST";

      const res = await fetch(url, {
        method,
        headers: getAuthHeaders(),
        credentials: "include",
        body: JSON.stringify({
          name: addFolderName.trim(),
          path: addFolderPath.trim(),
          excluded_folders: addFolderExclude.trim(),
          hidden_for_normal_users: addFolderHidden.trim(),
        }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setSuccess(data.message || (isEditing ? `แก้ไขโฟลเดอร์ '${addFolderName}' สำเร็จ!` : `เพิ่มโฟลเดอร์ '${addFolderName}' สำเร็จ!`));
        handleCancelEditFolder();
        loadData();
      } else {
        setError(data.message || (isEditing ? "ไม่สามารถแก้ไขโฟลเดอร์ได้" : "ไม่สามารถเพิ่มโฟลเดอร์ได้"));
      }
    } catch {
      setError("เกิดข้อผิดพลาดในการเชื่อมต่อเซิร์ฟเวอร์");
    } finally {
      setAddingFolder(false);
    }
  };

  const handleStartEditFolder = (af: AdditionalFolder) => {
    setEditingFolderId(af.id);
    setAddFolderName(af.name);
    setAddFolderPath(af.path);
    setAddFolderExclude(af.excluded_folders || "");
    setAddFolderHidden(af.hidden_for_normal_users || "");
    setError("");
    setSuccess("");
  };

  const handleCancelEditFolder = () => {
    setEditingFolderId(null);
    setAddFolderName("");
    setAddFolderPath("");
    setAddFolderExclude("");
    setAddFolderHidden("");
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
              <p className="text-xs text-zinc-400">จัดการโฟลเดอร์แชร์ (Network Share), Exclude โฟลเดอร์, และผู้ใช้งาน</p>
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
            <FolderPlus className="w-4 h-4" />
            โฟลเดอร์แชร์ / Share Folders ({additionalFolders.length})
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
          {/* TAB 1: Folders (Table & Add form) */}
          {activeTab === "folders" && (
            <div className="space-y-6">
              {/* Header bar with Refresh button */}
              <div className="flex items-center justify-between text-xs text-zinc-400 bg-zinc-950/60 p-3 rounded-xl border border-zinc-800/80">
                <span>📁 รายการโฟลเดอร์ Network Share ที่ระบบเปิดให้เข้าชม</span>
                <button
                  type="button"
                  onClick={loadData}
                  className="flex items-center gap-1 hover:text-zinc-200 font-medium cursor-pointer"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
                  รีเฟรช
                </button>
              </div>

              {/* Add / Edit form */}
              <form
                onSubmit={handleAddAdditionalFolder}
                className="p-4 bg-zinc-950/60 border border-zinc-800 rounded-xl space-y-3"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-rose-400 font-semibold text-xs uppercase tracking-wider">
                    {editingFolderId !== null ? <Pencil className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
                    <span>{editingFolderId !== null ? "แก้ไขโฟลเดอร์แชร์ (Edit Share Folder)" : "เพิ่มโฟลเดอร์แชร์ใหม่ (Network Share / UNC Path)"}</span>
                  </div>
                  {editingFolderId !== null && (
                    <button
                      type="button"
                      onClick={handleCancelEditFolder}
                      className="text-xs text-zinc-400 hover:text-zinc-200 cursor-pointer flex items-center gap-1"
                    >
                      <X className="w-3.5 h-3.5" /> ยกเลิกการแก้ไข
                    </button>
                  )}
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
                  <div>
                    <label className="block text-[11px] text-zinc-400 mb-1">ชื่อโฟลเดอร์ (แสดงในหน้าเว็บ)</label>
                    <input
                      type="text"
                      placeholder="เช่น VDO, bit, movies"
                      value={addFolderName}
                      onChange={(e) => setAddFolderName(e.target.value)}
                      className="w-full px-3 py-2 bg-zinc-900 border border-zinc-700 rounded-lg text-sm text-zinc-100 focus:outline-none focus:border-rose-500"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-zinc-400 mb-1">Network Share Path (UNC เท่านั้น)</label>
                    <input
                      type="text"
                      placeholder="เช่น \\192.168.1.242\plex$\VDO"
                      value={addFolderPath}
                      onChange={(e) => setAddFolderPath(e.target.value)}
                      className="w-full px-3 py-2 bg-zinc-900 border border-zinc-700 rounded-lg text-sm text-zinc-100 font-mono focus:outline-none focus:border-rose-500"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-zinc-400 mb-1">Exclude (level บนสุด คั่นด้วย comma)</label>
                    <input
                      type="text"
                      placeholder="เช่น PIC, Temp, $RECYCLE.BIN"
                      value={addFolderExclude}
                      onChange={(e) => setAddFolderExclude(e.target.value)}
                      className="w-full px-3 py-2 bg-zinc-900 border border-zinc-700 rounded-lg text-sm text-zinc-100 font-mono focus:outline-none focus:border-rose-500"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-zinc-400 mb-1">ซ่อน Folder ทั่วไป (คั่นด้วย comma)</label>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        placeholder="เช่น z1, z2, z3"
                        value={addFolderHidden}
                        onChange={(e) => setAddFolderHidden(e.target.value)}
                        className="w-full px-3 py-2 bg-zinc-900 border border-zinc-700 rounded-lg text-sm text-zinc-100 font-mono focus:outline-none focus:border-rose-500"
                      />
                      <button
                        type="submit"
                        disabled={addingFolder}
                        className={`px-4 py-2 text-white rounded-lg text-xs font-semibold transition shrink-0 disabled:opacity-50 cursor-pointer shadow-md ${
                          editingFolderId !== null
                            ? "bg-amber-600 hover:bg-amber-500 shadow-amber-600/20"
                            : "bg-rose-600 hover:bg-rose-500 shadow-rose-600/20"
                        }`}
                      >
                        {addingFolder
                          ? "กำลังตรวจ..."
                          : editingFolderId !== null
                          ? "บันทึก"
                          : "เพิ่ม"}
                      </button>
                    </div>
                  </div>
                </div>
              </form>

              {/* Table of Folders */}
              <div className="overflow-x-auto border border-zinc-800 rounded-xl">
                <table className="w-full text-left text-sm">
                  <thead className="bg-zinc-950/80 text-zinc-400 text-xs uppercase border-b border-zinc-800">
                    <tr>
                      <th className="py-2.5 px-4 font-semibold">ชื่อโฟลเดอร์</th>
                      <th className="py-2.5 px-4 font-semibold">Path โฟลเดอร์จริง (Network Share)</th>
                      <th className="py-2.5 px-4 font-semibold">Exclude (Level บนสุด)</th>
                      <th className="py-2.5 px-4 font-semibold">ซ่อนผู้ใช้ทั่วไป</th>
                      <th className="py-2.5 px-4 font-semibold text-right">การจัดการ</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-800 text-zinc-200">
                    {additionalFolders.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="py-8 text-center text-zinc-500 text-xs">
                          ยังไม่มีโฟลเดอร์ในระบบ กรุณาเพิ่มโฟลเดอร์ Network Share ด้านบน
                        </td>
                      </tr>
                    ) : (
                      additionalFolders.map((af) => (
                        <tr
                          key={af.id}
                          className={`transition ${
                            editingFolderId === af.id ? "bg-rose-950/20 border-l-2 border-rose-500" : "hover:bg-zinc-800/40"
                          }`}
                        >
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
                          <td className="py-3 px-4">
                            {af.hidden_for_normal_users ? (
                              <span className="font-mono text-xs text-rose-400/90 bg-rose-500/10 px-2 py-0.5 rounded border border-rose-500/20">
                                {af.hidden_for_normal_users}
                              </span>
                            ) : (
                              <span className="text-zinc-600 text-xs">-</span>
                            )}
                          </td>
                          <td className="py-3 px-4 text-right">
                            <div className="flex items-center justify-end gap-1">
                              <button
                                onClick={() => handleStartEditFolder(af)}
                                className={`p-1.5 rounded-lg transition cursor-pointer ${
                                  editingFolderId === af.id
                                    ? "text-amber-400 bg-amber-500/10"
                                    : "text-zinc-400 hover:text-amber-400 hover:bg-zinc-800"
                                }`}
                                title="แก้ไขโฟลเดอร์"
                              >
                                <Pencil className="w-4 h-4" />
                              </button>
                              <button
                                onClick={() => handleDeleteAdditionalFolder(af.id, af.name)}
                                className="p-1.5 text-zinc-500 hover:text-red-400 hover:bg-red-950/40 rounded-lg transition cursor-pointer"
                                title="ลบโฟลเดอร์"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* TAB 2: Users */}
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
