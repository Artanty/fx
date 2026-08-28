0x1401d7440: push rbx
0x1401d7442: push r12
0x1401d7444: push r13
0x1401d7446: push r14
0x1401d7448: sub rsp, 0x28
0x1401d744c: cmp byte ptr [rcx + 0x5e], 0
0x1401d7450: mov r13, r9
0x1401d7453: mov r14, r8
0x1401d7456: mov r12, rdx
0x1401d7459: mov rbx, rcx
0x1401d745c: je 0x1401d746f
0x1401d745e: mov edx, 0x32
0x1401d7463: lea rcx, [rip + 0x724286]   ; -> 0x1408fb6f0
0x1401d746a: call 0x1404861a0   [CALL]
0x1401d746f: mov qword ptr [rsp + 0x50], rbp
0x1401d7474: mov qword ptr [rsp + 0x58], rsi
0x1401d7479: mov qword ptr [rsp + 0x60], rdi
0x1401d747e: mov qword ptr [rsp + 0x20], r15
0x1401d7483: test r14, r14
0x1401d7486: je 0x1401d75c4
0x1401d748c: cmp byte ptr [rbx + 0x5d], 0
0x1401d7490: lea r8, [rip + 0x63f699]   ; -> 0x140816b30
0x1401d7497: je 0x1401d75c0
0x1401d749d: lea rdi, [rbx + 0x5c]
0x1401d74a1: mov qword ptr [rbx], r12
0x1401d74a4: xor edx, edx
0x1401d74a6: mov dword ptr [rbx + 8], r14d
0x1401d74aa: lea r15, [rbx + 0x5f]
0x1401d74ae: mov dword ptr [rbx + 0x18], 0x8000
0x1401d74b5: mov qword ptr [rbx + 0x10], r15
0x1401d74b9: cmp byte ptr [rdi], dl
0x1401d74bb: je 0x1401d7571
0x1401d74c1: mov rbp, qword ptr [rbx + 0x28]
0x1401d74c5: mov esi, dword ptr [rbx + 0x58]
0x1401d74c8: test rbp, rbp
0x1401d74cb: je 0x1401d756a
0x1401d74d1: cmp esi, -1
0x1401d74d4: jne 0x1401d74dd
0x1401d74d6: mov esi, 6
0x1401d74db: jmp 0x1401d74e6
0x1401d74dd: cmp esi, 9
0x1401d74e0: ja 0x1401d756a
0x1401d74e6: movsxd rcx, dword ptr [rbp + 0xac]
0x1401d74ed: movsxd rdi, esi
0x1401d74f0: add rcx, rcx
0x1401d74f3: add rdi, rdi
0x1401d74f6: mov rax, qword ptr [r8 + rdi*8 + 8]
0x1401d74fb: cmp qword ptr [r8 + rcx*8 + 8], rax
0x1401d7500: je 0x1401d751d
0x1401d7502: cmp dword ptr [rbx + 0xc], edx
0x1401d7505: je 0x1401d751d
0x1401d7507: mov edx, 1
0x1401d750c: mov rcx, rbx
0x1401d750f: call 0x140450950   [CALL]
0x1401d7514: mov edx, eax
0x1401d7516: lea r8, [rip + 0x63f613]   ; -> 0x140816b30
0x1401d751d: cmp dword ptr [rbp + 0xac], esi
0x1401d7523: je 0x1401d755a
0x1401d7525: mov dword ptr [rbp + 0xac], esi
0x1401d752b: movzx eax, word ptr [r8 + rdi*8 + 2]
0x1401d7531: mov dword ptr [rbp + 0xa8], eax
0x1401d7537: movzx eax, word ptr [r8 + rdi*8]
0x1401d753c: mov dword ptr [rbp + 0xb4], eax
0x1401d7542: movzx eax, word ptr [r8 + rdi*8 + 4]
0x1401d7548: mov dword ptr [rbp + 0xb8], eax
0x1401d754e: movzx eax, word ptr [r8 + rdi*8 + 6]
0x1401d7554: mov dword ptr [rbp + 0xa4], eax
0x1401d755a: mov dword ptr [rbp + 0xb0], 0
0x1401d7564: lea rdi, [rbx + 0x5c]
0x1401d7568: jmp 0x1401d757b
0x1401d756a: mov edx, 0xfffffffe
0x1401d756f: jmp 0x1401d757b
0x1401d7571: mov rcx, rbx
0x1401d7574: call 0x140450950   [CALL]
0x1401d7579: mov edx, eax
0x1401d757b: mov byte ptr [rdi], 0
0x1401d757e: test edx, edx
0x1401d7580: je 0x1401d758a
0x1401d7582: cmp edx, 1
0x1401d7585: jne 0x1401d75c0
0x1401d7587: mov byte ptr [rbx + 0x5e], dl
0x1401d758a: mov eax, dword ptr [rbx + 8]
0x1401d758d: mov r8d, 0x8000
0x1401d7593: sub r14, rax
0x1401d7596: add r12, r14
0x1401d7599: mov r14d, eax
0x1401d759c: mov eax, dword ptr [rbx + 0x18]
0x1401d759f: sub r8, rax
0x1401d75a2: test r8, r8
0x1401d75a5: jle 0x1401d7483
0x1401d75ab: mov rax, qword ptr [r13]
0x1401d75af: mov rdx, r15
0x1401d75b2: mov rcx, r13
0x1401d75b5: call qword ptr [rax + 0x20]   [CALL]
0x1401d75b8: test al, al
0x1401d75ba: jne 0x1401d7483
0x1401d75c0: xor al, al
0x1401d75c2: jmp 0x1401d75c6
0x1401d75c4: mov al, 1
0x1401d75c6: mov r15, qword ptr [rsp + 0x20]
0x1401d75cb: mov rdi, qword ptr [rsp + 0x60]
0x1401d75d0: mov rsi, qword ptr [rsp + 0x58]
0x1401d75d5: mov rbp, qword ptr [rsp + 0x50]
0x1401d75da: add rsp, 0x28
0x1401d75de: pop r14
0x1401d75e0: pop r13
0x1401d75e2: pop r12
0x1401d75e4: pop rbx
0x1401d75e5: ret 
0x1401d75e6: int3 
0x1401d75e7: int3 
0x1401d75e8: int3 
0x1401d75e9: int3 
0x1401d75ea: int3 
0x1401d75eb: int3 
0x1401d75ec: int3 
0x1401d75ed: int3 
0x1401d75ee: int3 
0x1401d75ef: int3 
