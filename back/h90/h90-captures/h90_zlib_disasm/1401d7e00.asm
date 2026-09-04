0x1401d7e00: mov qword ptr [rsp + 0x10], rbx
0x1401d7e05: push rbp
0x1401d7e06: push rsi
0x1401d7e07: push rdi
0x1401d7e08: push r12
0x1401d7e0a: push r13
0x1401d7e0c: push r14
0x1401d7e0e: push r15
0x1401d7e10: lea rbp, [rsp - 0x27]
0x1401d7e15: sub rsp, 0xc0
0x1401d7e1c: mov r13, r8
0x1401d7e1f: mov r15, rdx
0x1401d7e22: mov rdi, rcx
0x1401d7e25: xor r12d, r12d
0x1401d7e28: call 0x14047c080   [CALL]
0x1401d7e2d: mov rdx, rax
0x1401d7e30: lea rcx, [rbp - 0x29]
0x1401d7e34: call 0x140482cc0   [CALL]
0x1401d7e39: nop 
0x1401d7e3a: lea r14, [rip + 0x8338df]   ; -> 0x140a0b720
0x1401d7e41: mov esi, 0xffffffff
0x1401d7e46: lea rax, [rip + 0x726cbb]   ; -> 0x1408feb08
0x1401d7e4d: cmp byte ptr [rdi + 0x40], r12b
0x1401d7e51: je 0x1401d7fba
0x1401d7e57: xor r8d, r8d
0x1401d7e5a: mov rdx, rdi
0x1401d7e5d: lea rcx, [rbp + 0x67]
0x1401d7e61: call 0x140447e60   [CALL]
0x1401d7e66: nop 
0x1401d7e67: mov r9d, 0x2f
0x1401d7e6d: mov r8d, 0x5c
0x1401d7e73: lea rdx, [rbp + 0x7f]
0x1401d7e77: lea rcx, [rbp + 0x67]
0x1401d7e7b: call 0x1404830a0   [CALL]
0x1401d7e80: nop 
0x1401d7e81: mov rcx, qword ptr [rbp + 0x67]
0x1401d7e85: add rcx, -0x10
0x1401d7e89: cmp rcx, r14
0x1401d7e8c: je 0x1401d7e9f
0x1401d7e8e: mov eax, esi
0x1401d7e90: lock xadd dword ptr [rcx], eax
0x1401d7e94: dec eax
0x1401d7e96: cmp eax, esi
0x1401d7e98: jne 0x1401d7e9f
0x1401d7e9a: call 0x1402e5784   [CALL]
0x1401d7e9f: mov rbx, qword ptr [rbp + 0x7f]
0x1401d7ea3: mov rax, rbx
0x1401d7ea6: mov r8, r12
0x1401d7ea9: nop dword ptr [rax]
0x1401d7eb0: movzx ecx, byte ptr [rax]
0x1401d7eb3: inc rax
0x1401d7eb6: test cl, cl
0x1401d7eb8: jns 0x1401d7ee3
0x1401d7eba: movzx ecx, byte ptr [rax]
0x1401d7ebd: and cl, 0xc0
0x1401d7ec0: cmp cl, 0x80
0x1401d7ec3: jne 0x1401d7ee7
0x1401d7ec5: nop word ptr [rax + rax]
0x1401d7ed0: inc rax
0x1401d7ed3: movzx ecx, byte ptr [rax]
0x1401d7ed6: and cl, 0xc0
0x1401d7ed9: cmp cl, 0x80
0x1401d7edc: je 0x1401d7ed0
0x1401d7ede: inc r8
0x1401d7ee1: jmp 0x1401d7eb0
0x1401d7ee3: test ecx, ecx
0x1401d7ee5: je 0x1401d7eec
0x1401d7ee7: inc r8
0x1401d7eea: jmp 0x1401d7eb0
0x1401d7eec: movsxd rax, r8d
0x1401d7eef: mov qword ptr [rdi + 0x28], rax
0x1401d7ef3: test rbx, rbx
0x1401d7ef6: je 0x1401d7f05
0x1401d7ef8: mov rdx, rbx
0x1401d7efb: xor ecx, ecx
0x1401d7efd: call 0x140451c10   [CALL]
0x1401d7f02: mov r12d, eax
0x1401d7f05: mov dword ptr [rdi + 0x3c], r12d
0x1401d7f09: mov rcx, rbx
0x1401d7f0c: call 0x1401e0e50   [CALL]
0x1401d7f11: mov rcx, qword ptr [rbp - 0x29]
0x1401d7f15: mov r9, qword ptr [rcx + 0x20]
0x1401d7f19: mov r8, rax
0x1401d7f1c: mov rdx, rbx
0x1401d7f1f: lea rcx, [rbp - 0x29]
0x1401d7f23: call r9   [CALL]
0x1401d7f26: nop 
0x1401d7f27: lea rcx, [rbx - 0x10]
0x1401d7f2b: cmp rcx, r14
0x1401d7f2e: je 0x1401d7f42
0x1401d7f30: mov eax, esi
0x1401d7f32: lock xadd dword ptr [rcx], eax
0x1401d7f36: dec eax
0x1401d7f38: cmp eax, -1
0x1401d7f3b: jne 0x1401d7f42
0x1401d7f3d: call 0x1402e5784   [CALL]
0x1401d7f42: mov rax, qword ptr [rbp + 0xf]
0x1401d7f46: mov qword ptr [rdi + 0x20], rax
0x1401d7f4a: mov rax, qword ptr [r15]
0x1401d7f4d: mov rcx, r15
0x1401d7f50: call qword ptr [rax + 0x18]   [CALL]
0x1401d7f53: sub rax, r13
0x1401d7f56: mov qword ptr [rdi + 0x30], rax
0x1401d7f5a: mov rax, qword ptr [r15]
0x1401d7f5d: mov edx, 0x4034b50
0x1401d7f62: mov rcx, r15
0x1401d7f65: call qword ptr [rax + 0x48]   [CALL]
0x1401d7f68: mov rdx, r15
0x1401d7f6b: mov rcx, rdi
0x1401d7f6e: call 0x1401d8480   [CALL]
0x1401d7f73: mov rcx, qword ptr [rdi + 0x10]
0x1401d7f77: call 0x1401e0e50   [CALL]
0x1401d7f7c: mov rcx, qword ptr [r15]
0x1401d7f7f: mov r9, qword ptr [rcx + 0x20]
0x1401d7f83: mov r8, rax
0x1401d7f86: mov rdx, qword ptr [rdi + 0x10]
0x1401d7f8a: mov rcx, r15
0x1401d7f8d: call r9   [CALL]
0x1401d7f90: mov r8, qword ptr [rbp + 0xf]
0x1401d7f94: test r8, r8
0x1401d7f97: je 0x1401d8105
0x1401d7f9d: mov rax, qword ptr [r15]
0x1401d7fa0: mov r9, qword ptr [rax + 0x20]
0x1401d7fa4: mov rax, qword ptr [rbp - 0x19]
0x1401d7fa8: test rax, rax
0x1401d7fab: jne 0x1401d80ea
0x1401d7fb1: mov rdx, qword ptr [rbp - 1]
0x1401d7fb5: jmp 0x1401d80ff
0x1401d7fba: mov r14d, dword ptr [rdi + 0x38]
0x1401d7fbe: test r14d, r14d
0x1401d7fc1: jle 0x1401d80d2
0x1401d7fc7: mov qword ptr [rbp - 0x59], rax
0x1401d7fcb: lea rbx, [rip + 0x7231d6]   ; -> 0x1408fb1a8
0x1401d7fd2: mov rdx, rbx
0x1401d7fd5: lea rcx, [rbp - 0x51]
0x1401d7fd9: call 0x1401e0420   [CALL]
0x1401d7fde: mov eax, 0x7ffffffe
0x1401d7fe3: movzx ecx, byte ptr [rbx]
0x1401d7fe6: test cl, cl
0x1401d7fe8: jle 0x1401d7ff4
0x1401d7fea: inc rbx
0x1401d7fed: sub eax, 1
0x1401d7ff0: jns 0x1401d7fe3
0x1401d7ff2: jmp 0x1401d8008
0x1401d7ff4: je 0x1401d8008
0x1401d7ff6: mov edx, 0x13b
0x1401d7ffb: lea rcx, [rip + 0x6397ae]   ; "C:\Jenkins\workspace\audio-apps\h90control\H90\AppCommon\juce-modules\modules\juce_core\text/juce_String.cpp"
0x1401d8002: call 0x1404861a0   [CALL]
0x1401d8007: nop 
0x1401d8008: lea rax, [rip + 0x72a7b1]   ; -> 0x1409027c0
0x1401d800f: mov qword ptr [rbp - 0x59], rax
0x1401d8013: lea rax, [rbp - 0x29]
0x1401d8017: mov qword ptr [rbp - 0x49], rax
0x1401d801b: mov byte ptr [rbp - 0x41], 0
0x1401d801f: mov ecx, 0x8060
0x1401d8024: call 0x1402e5500   [CALL]
0x1401d8029: mov rbx, rax
0x1401d802c: mov qword ptr [rbp + 0x67], rax
0x1401d8030: mov ecx, esi
0x1401d8032: cmp r14d, 9
0x1401d8036: cmovbe ecx, r14d
0x1401d803a: mov dword ptr [rax + 0x58], ecx
0x1401d803d: mov word ptr [rax + 0x5c], 1
0x1401d8043: mov byte ptr [rax + 0x5e], 0
0x1401d8047: xorps xmm0, xmm0
0x1401d804a: xor eax, eax
0x1401d804c: movups xmmword ptr [rbx], xmm0
0x1401d804f: movups xmmword ptr [rbx + 0x10], xmm0
0x1401d8053: movups xmmword ptr [rbx + 0x20], xmm0
0x1401d8057: movups xmmword ptr [rbx + 0x30], xmm0
0x1401d805b: movups xmmword ptr [rbx + 0x40], xmm0
0x1401d805f: mov qword ptr [rbx + 0x50], rax
0x1401d8063: lea rax, [rip + 0x723706]   ; "1.2.3"
0x1401d806a: mov qword ptr [rsp + 0x30], rax
0x1401d806f: mov dword ptr [rsp + 0x28], r12d
0x1401d8074: mov dword ptr [rsp + 0x20], 8
0x1401d807c: mov r9d, 0xfffffff1
0x1401d8082: mov r8d, 8
0x1401d8088: mov edx, dword ptr [rbx + 0x58]
0x1401d808b: mov rcx, rbx
0x1401d808e: call 0x1404515f0   [CALL]
0x1401d8093: test eax, eax
0x1401d8095: sete al
0x1401d8098: mov byte ptr [rbx + 0x5d], al
0x1401d809b: mov qword ptr [rbp - 0x39], rbx
0x1401d809f: lea rax, [rip + 0x72a71a]   ; -> 0x1409027c0
0x1401d80a6: mov qword ptr [rbp - 0x59], rax
0x1401d80aa: lea rdx, [rbp - 0x59]
0x1401d80ae: mov rcx, rdi
0x1401d80b1: call 0x1401d8330   [CALL]
0x1401d80b6: nop 
0x1401d80b7: lea rcx, [rbp - 0x59]
0x1401d80bb: test al, al
0x1401d80bd: jne 0x1401d80c8
0x1401d80bf: call 0x140481ff0   [CALL]
0x1401d80c4: xor bl, bl
0x1401d80c6: jmp 0x1401d8107
0x1401d80c8: call 0x140481ff0   [CALL]
0x1401d80cd: jmp 0x1401d7f42
0x1401d80d2: lea rdx, [rbp - 0x29]
0x1401d80d6: mov rcx, rdi
0x1401d80d9: call 0x1401d8330   [CALL]
0x1401d80de: test al, al
0x1401d80e0: jne 0x1401d7f42
0x1401d80e6: xor bl, bl
0x1401d80e8: jmp 0x1401d8107
0x1401d80ea: cmp qword ptr [rax + 8], r8
0x1401d80ee: jbe 0x1401d80fc
0x1401d80f0: mov rax, qword ptr [rax]
0x1401d80f3: mov byte ptr [rax + r8], 0
0x1401d80f8: mov rax, qword ptr [rbp - 0x19]
0x1401d80fc: mov rdx, qword ptr [rax]
0x1401d80ff: mov rcx, r15
0x1401d8102: call r9   [CALL]
0x1401d8105: mov bl, 1
0x1401d8107: lea rax, [rip + 0x72681a]   ; -> 0x1408fe928
0x1401d810e: mov qword ptr [rbp - 0x29], rax
0x1401d8112: lea rax, [rbp - 0x11]
0x1401d8116: mov rcx, qword ptr [rbp - 0x19]
0x1401d811a: cmp rcx, rax
0x1401d811d: je 0x1401d8130
0x1401d811f: test rcx, rcx
0x1401d8122: je 0x1401d8130
0x1401d8124: xor r8d, r8d
0x1401d8127: mov rdx, qword ptr [rbp + 0xf]
0x1401d812b: call 0x14046dba0   [CALL]
0x1401d8130: mov rcx, qword ptr [rbp - 0x11]
0x1401d8134: call 0x1402ec0f4   [CALL]
0x1401d8139: lea rax, [rip + 0x7269c8]   ; -> 0x1408feb08
0x1401d8140: mov qword ptr [rbp - 0x29], rax
0x1401d8144: mov rcx, qword ptr [rbp - 0x21]
0x1401d8148: add rcx, -0x10
0x1401d814c: lea rax, [rip + 0x8335cd]   ; -> 0x140a0b720
0x1401d8153: cmp rcx, rax
0x1401d8156: je 0x1401d8169
0x1401d8158: lock xadd dword ptr [rcx], esi
0x1401d815c: dec esi
0x1401d815e: cmp esi, -1
0x1401d8161: jne 0x1401d8169
0x1401d8163: call 0x1402e5784   [CALL]
0x1401d8168: nop 
0x1401d8169: movzx eax, bl
0x1401d816c: mov rbx, qword ptr [rsp + 0x108]
0x1401d8174: add rsp, 0xc0
0x1401d817b: pop r15
0x1401d817d: pop r14
0x1401d817f: pop r13
0x1401d8181: pop r12
0x1401d8183: pop rdi
0x1401d8184: pop rsi
0x1401d8185: pop rbp
0x1401d8186: ret 
0x1401d8187: int3 
0x1401d8188: int3 
0x1401d8189: int3 
0x1401d818a: int3 
0x1401d818b: int3 
0x1401d818c: int3 
0x1401d818d: int3 
0x1401d818e: int3 
0x1401d818f: int3 
