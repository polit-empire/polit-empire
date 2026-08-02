import os
import shutil
import subprocess

def main():
    src_dir = 'launcher'
    dest_dir = 'launcher-linux'
    
    # Get tracked files in launcher using git
    result = subprocess.run(['git', 'ls-files', src_dir], capture_output=True, text=True)
    if result.returncode != 0:
        print("Error running git ls-files")
        return
        
    files = result.stdout.strip().split('\n')
    for f in files:
        if not f.startswith(src_dir): continue
        
        # Determine destination path
        rel_path = os.path.relpath(f, src_dir)
        dest_path = os.path.join(dest_dir, rel_path)
        
        # Create directories if they don't exist
        os.makedirs(os.path.dirname(dest_path), exist_ok=True)
        
        # Copy file
        shutil.copy2(f, dest_path)
        print(f"Copied {f} to {dest_path}")
        
if __name__ == '__main__':
    main()
