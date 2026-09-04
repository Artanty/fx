0x1401d75f0: push rbx
0x1401d75f2: push rbp
0x1401d75f3: push r12
0x1401d75f5: push r13
0x1401d75f7: sub rsp, 0x28
0x1401d75fb: xor r12d, r12d
0x1401d75fe: xor ebp, ebp
0x1401d7600: mov r13, rdx
0x1401d7603: mov rbx, rcx
0x1401d7606: cmp byte ptr [rcx + 0x5e], bpl
0x1401d760a: jne 0x1401d7774
0x1401d7610: mov qword ptr [rsp + 0x50], rsi
0x1401d7615: lea r8, [rip + 0x63f514]   ; -> 0x140816b30
0x1401d761c: mov qword ptr [rsp + 0x58], rdi
0x1401d7621: mov qword ptr [rsp + 0x60], r14
0x1401d7626: mov qword ptr [rsp + 0x20], r15
0x1401d762b: nop dword ptr [rax + rax]
0x1401d7630: cmp byte ptr [rbx + 0x5d], 0
0x1401d7634: je 0x1401d7756
0x1401d763a: cmp byte ptr [rbx + 0x5c], 0
0x1401d763e: lea r15, [rbx + 0x5f]
0x1401d7642: mov qword ptr [rbx + 0x10], r15
0x1401d7646: mov qword ptr [rbx], r12
0x1401d7649: mov dword ptr [rbx + 8], ebp
0x1401d764c: mov dword ptr [rbx + 0x18], 0x8000
0x1401d7653: je 0x1401d7707
0x1401d7659: mov rdi, qword ptr [rbx + 0x28]
0x1401d765d: xor edx, edx
0x1401d765f: test rdi, rdi
0x1401d7662: je 0x1401d7700
0x1401d7668: mov esi, dword ptr [rbx + 0x58]
0x1401d766b: cmp esi, -1
0x1401d766e: jne 0x1401d7677
0x1401d7670: mov esi, 6
0x1401d7675: jmp 0x1401d7680
0x1401d7677: cmp esi, 9
0x1401d767a: ja 0x1401d7700
0x1401d7680: movsxd rcx, dword ptr [rdi + 0xac]
0x1401d7687: movsxd r14, esi
0x1401d768a: add rcx, rcx
0x1401d768d: add r14, r14
0x1401d7690: mov rax, qword ptr [r8 + r14*8 + 8]
0x1401d7695: cmp qword ptr [r8 + rcx*8 + 8], rax
0x1401d769a: je 0x1401d76b7
0x1401d769c: cmp dword ptr [rbx + 0xc], edx
0x1401d769f: je 0x1401d76b7
0x1401d76a1: mov edx, 1
0x1401d76a6: mov rcx, rbx
0x1401d76a9: call 0x140450950   [CALL]
0x1401d76ae: mov edx, eax
0x1401d76b0: lea r8, [rip + 0x63f479]   ; -> 0x140816b30
0x1401d76b7: cmp dword ptr [rdi + 0xac], esi
0x1401d76bd: je 0x1401d76f4
0x1401d76bf: mov dword ptr [rdi + 0xac], esi
0x1401d76c5: movzx eax, word ptr [r8 + r14*8 + 2]
0x1401d76cb: mov dword ptr [rdi + 0xa8], eax
0x1401d76d1: movzx eax, word ptr [r8 + r14*8]
0x1401d76d6: mov dword ptr [rdi + 0xb4], eax
0x1401d76dc: movzx eax, word ptr [r8 + r14*8 + 4]
0x1401d76e2: mov dword ptr [rdi + 0xb8], eax
0x1401d76e8: movzx eax, word ptr [r8 + r14*8 + 6]
0x1401d76ee: mov dword ptr [rdi + 0xa4], eax
0x1401d76f4: mov dword ptr [rdi + 0xb0], 0
0x1401d76fe: jmp 0x1401d7716
0x1401d7700: mov edx, 0xfffffffe
0x1401d7705: jmp 0x1401d7716
0x1401d7707: mov edx, 4
0x1401d770c: mov rcx, rbx
0x1401d770f: call 0x140450950   [CALL]
0x1401d7714: mov edx, eax
0x1401d7716: mov byte ptr [rbx + 0x5c], 0
0x1401d771a: test edx, edx
0x1401d771c: je 0x1401d7726
0x1401d771e: cmp edx, 1
0x1401d7721: jne 0x1401d774f
0x1401d7723: mov byte ptr [rbx + 0x5e], dl
0x1401d7726: mov eax, dword ptr [rbx + 8]
0x1401d7729: mov r8d, 0x8000
0x1401d772f: sub rbp, rax
0x1401d7732: add r12, rbp
0x1401d7735: mov ebp, eax
0x1401d7737: mov eax, dword ptr [rbx + 0x18]
0x1401d773a: sub r8, rax
0x1401d773d: test r8, r8
0x1401d7740: jle 0x1401d774f
0x1401d7742: mov rax, qword ptr [r13]
0x1401d7746: mov rdx, r15
0x1401d7749: mov rcx, r13
0x1401d774c: call qword ptr [rax + 0x20]   [CALL]
0x1401d774f: lea r8, [rip + 0x63f3da]   ; -> 0x140816b30
0x1401d7756: cmp byte ptr [rbx + 0x5e], 0
0x1401d775a: je 0x1401d7630
0x1401d7760: mov r15, qword ptr [rsp + 0x20]
0x1401d7765: mov r14, qword ptr [rsp + 0x60]
0x1401d776a: mov rdi, qword ptr [rsp + 0x58]
0x1401d776f: mov rsi, qword ptr [rsp + 0x50]
0x1401d7774: add rsp, 0x28
0x1401d7778: pop r13
0x1401d777a: pop r12
0x1401d777c: pop rbp
0x1401d777d: pop rbx
0x1401d777e: ret 
0x1401d777f: int3 
0x1401d7780: mov qword ptr [rsp + 8], rbx
0x1401d7785: push rdi
0x1401d7786: sub rsp, 0x20
0x1401d778a: mov ebx, edx
0x1401d778c: mov rdi, rcx
0x1401d778f: call 0x140481ff0   [CALL]
0x1401d7794: test bl, 1
0x1401d7797: je 0x1401d77a6
0x1401d7799: mov edx, 0x28
0x1401d779e: mov rcx, rdi
0x1401d77a1: call 0x1402e5784   [CALL]
0x1401d77a6: mov rbx, qword ptr [rsp + 0x30]
0x1401d77ab: mov rax, rdi
0x1401d77ae: add rsp, 0x20
0x1401d77b2: pop rdi
0x1401d77b3: ret 
0x1401d77b4: int3 
0x1401d77b5: int3 
0x1401d77b6: int3 
0x1401d77b7: int3 
0x1401d77b8: int3 
0x1401d77b9: int3 
0x1401d77ba: int3 
0x1401d77bb: int3 
0x1401d77bc: int3 
0x1401d77bd: int3 
0x1401d77be: int3 
0x1401d77bf: int3 
