import re

with open('src/inject.rs', 'r', encoding='utf-8') as f:
    text = f.read()

# 1. Remove the suspicious imports
text = text.replace('CreateToolhelp32Snapshot, Module32FirstW, Module32NextW, ', '')
text = text.replace('VirtualAllocEx, ', '')
text = text.replace('CreateRemoteThread, OpenProcess, ', '')
text = text.replace('use windows_sys::Win32::System::Diagnostics::Debug::WriteProcessMemory;', '')

# 2. Insert get_api helper inside inject_into (around line 260)
helper = '''
    unsafe fn get_api<T>(module: &str, func: &str) -> Option<T> {
        use windows_sys::Win32::System::LibraryLoader::{GetModuleHandleA, GetProcAddress, LoadLibraryA};
        let c_mod = std::ffi::CString::new(module).unwrap();
        let mut handle = GetModuleHandleA(c_mod.as_ptr() as *const u8);
        if handle.is_null() {
            handle = LoadLibraryA(c_mod.as_ptr() as *const u8);
        }
        if handle.is_null() { return None; }
        let c_func = std::ffi::CString::new(func).unwrap();
        let addr = GetProcAddress(handle, c_func.as_ptr() as *const u8);
        if addr.is_none() { return None; }
        Some(std::mem::transmute_copy(&addr))
    }

    use windows_sys::Win32::Foundation::{HANDLE, BOOL};
    type OpenProcessFn = unsafe extern "system" fn(u32, BOOL, u32) -> HANDLE;
    type VirtualAllocExFn = unsafe extern "system" fn(HANDLE, *const core::ffi::c_void, usize, u32, u32) -> *mut core::ffi::c_void;
    type WriteProcessMemoryFn = unsafe extern "system" fn(HANDLE, *const core::ffi::c_void, *const core::ffi::c_void, usize, *mut usize) -> BOOL;
    type CreateRemoteThreadFn = unsafe extern "system" fn(HANDLE, *const core::ffi::c_void, usize, Option<unsafe extern "system" fn(*mut core::ffi::c_void) -> u32>, *const core::ffi::c_void, u32, *mut u32) -> HANDLE;

    let p_OpenProcess: OpenProcessFn = unsafe { get_api("kernel32.dll", "OpenProcess").unwrap() };
    let p_VirtualAllocEx: VirtualAllocExFn = unsafe { get_api("kernel32.dll", "VirtualAllocEx").unwrap() };
    let p_WriteProcessMemory: WriteProcessMemoryFn = unsafe { get_api("kernel32.dll", "WriteProcessMemory").unwrap() };
    let p_CreateRemoteThread: CreateRemoteThreadFn = unsafe { get_api("kernel32.dll", "CreateRemoteThread").unwrap() };
'''

text = text.replace('    let dll_path = anticheat_dll_path();', helper + '\\n    let dll_path = anticheat_dll_path();', 1)

# 3. Replace calls in inject_into
text = text.replace('OpenProcess(access, FALSE, pid)', 'p_OpenProcess(access, FALSE, pid)')
text = text.replace('VirtualAllocEx(', 'p_VirtualAllocEx(')
text = text.replace('WriteProcessMemory(', 'p_WriteProcessMemory(')
text = text.replace('CreateRemoteThread(', 'p_CreateRemoteThread(')

# 4. Insert get_api helper inside module_present
helper_mp = '''
        use windows_sys::Win32::Foundation::{HANDLE, BOOL};
        type CreateToolhelp32SnapshotFn = unsafe extern "system" fn(u32, u32) -> HANDLE;
        type Module32FirstWFn = unsafe extern "system" fn(HANDLE, *mut MODULEENTRY32W) -> BOOL;
        type Module32NextWFn = unsafe extern "system" fn(HANDLE, *mut MODULEENTRY32W) -> BOOL;
        
        unsafe fn get_api<T>(module: &str, func: &str) -> Option<T> {
            use windows_sys::Win32::System::LibraryLoader::{GetModuleHandleA, GetProcAddress, LoadLibraryA};
            let c_mod = std::ffi::CString::new(module).unwrap();
            let mut handle = GetModuleHandleA(c_mod.as_ptr() as *const u8);
            if handle.is_null() { handle = LoadLibraryA(c_mod.as_ptr() as *const u8); }
            if handle.is_null() { return None; }
            let c_func = std::ffi::CString::new(func).unwrap();
            let addr = GetProcAddress(handle, c_func.as_ptr() as *const u8);
            if addr.is_none() { return None; }
            Some(std::mem::transmute_copy(&addr))
        }

        let p_CreateToolhelp32Snapshot: CreateToolhelp32SnapshotFn = get_api("kernel32.dll", "CreateToolhelp32Snapshot").unwrap();
        let p_Module32FirstW: Module32FirstWFn = get_api("kernel32.dll", "Module32FirstW").unwrap();
        let p_Module32NextW: Module32NextWFn = get_api("kernel32.dll", "Module32NextW").unwrap();
'''

text = text.replace('        let snap = CreateToolhelp32Snapshot(', helper_mp + '\\n        let snap = p_CreateToolhelp32Snapshot(', 1)
text = text.replace('Module32FirstW(snap, &mut entry)', 'p_Module32FirstW(snap, &mut entry)')
text = text.replace('Module32NextW(snap, &mut entry)', 'p_Module32NextW(snap, &mut entry)')

with open('src/inject.rs', 'w', encoding='utf-8') as f:
    f.write(text)
