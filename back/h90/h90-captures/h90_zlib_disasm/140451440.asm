0x140451440: push rbx
0x140451442: sub rsp, 0x20
0x140451446: test rcx, rcx
0x140451449: je 0x1404515d3
0x14045144f: mov rbx, qword ptr [rcx + 0x28]
0x140451453: test rbx, rbx
0x140451456: je 0x1404515d3
0x14045145c: cmp qword ptr [rcx + 0x30], 0
0x140451461: je 0x1404515d3
0x140451467: cmp qword ptr [rcx + 0x38], 0
0x14045146c: je 0x1404515d3
0x140451472: mov dword ptr [rcx + 0x48], 2
0x140451479: mov qword ptr [rsp + 0x30], rdi
0x14045147e: xor edi, edi
0x140451480: mov dword ptr [rcx + 0x1c], edi
0x140451483: mov dword ptr [rcx + 0xc], edi
0x140451486: mov qword ptr [rcx + 0x20], rdi
0x14045148a: mov rax, qword ptr [rbx + 0x10]
0x14045148e: mov edx, dword ptr [rbx + 0x2c]
0x140451491: mov qword ptr [rbx + 0x20], rax
0x140451495: mov dword ptr [rbx + 0x28], edi
0x140451498: test edx, edx
0x14045149a: jns 0x1404514a1
0x14045149c: neg edx
0x14045149e: mov dword ptr [rbx + 0x2c], edx
0x1404514a1: test edx, edx
0x1404514a3: mov eax, 0x71
0x1404514a8: mov r8d, 0x2a
0x1404514ae: cmovne eax, r8d
0x1404514b2: cmp edx, 2
0x1404514b5: mov dword ptr [rbx + 8], eax
0x1404514b8: mov eax, edi
0x1404514ba: setne al
0x1404514bd: mov dword ptr [rcx + 0x4c], eax
0x1404514c0: lea rax, [rbx + 0xbc]
0x1404514c7: mov qword ptr [rbx + 0xb40], rax
0x1404514ce: mov rcx, rbx
0x1404514d1: lea rax, [rip + 0x5ba220]   ; -> 0x140a0b6f8
0x1404514d8: mov dword ptr [rbx + 0x40], edi
0x1404514db: mov qword ptr [rbx + 0xb50], rax
0x1404514e2: lea rax, [rbx + 0x9b0]
0x1404514e9: mov qword ptr [rbx + 0xb58], rax
0x1404514f0: lea rax, [rip + 0x5ba1c1]   ; -> 0x140a0b6b8
0x1404514f7: mov qword ptr [rbx + 0xb68], rax
0x1404514fe: lea rax, [rbx + 0xaa4]
0x140451505: mov qword ptr [rbx + 0xb70], rax
0x14045150c: lea rax, [rip + 0x5ba1c5]   ; -> 0x140a0b6d8
0x140451513: mov qword ptr [rbx + 0xb80], rax
0x14045151a: mov word ptr [rbx + 0x1710], di
0x140451521: mov dword ptr [rbx + 0x1714], edi
0x140451527: mov dword ptr [rbx + 0x170c], 8
0x140451531: call 0x14044ce20
0x140451536: mov ecx, dword ptr [rbx + 0x44]
0x140451539: xor edx, edx
0x14045153b: mov rax, qword ptr [rbx + 0x68]
0x14045153f: add ecx, ecx
0x140451541: mov dword ptr [rbx + 0x58], ecx
0x140451544: mov ecx, dword ptr [rbx + 0x74]
0x140451547: dec ecx
0x140451549: mov word ptr [rax + rcx*2], di
0x14045154d: mov r8d, dword ptr [rbx + 0x74]
0x140451551: mov rcx, qword ptr [rbx + 0x68]
0x140451555: dec r8d
0x140451558: add r8, r8
0x14045155b: call 0x140659f50
0x140451560: movsxd rcx, dword ptr [rbx + 0xac]
0x140451567: lea rdx, [rip + 0x3c55c2]   ; -> 0x140816b30
0x14045156e: add rcx, rcx
0x140451571: movzx eax, word ptr [rdx + rcx*8 + 2]
0x140451576: mov dword ptr [rbx + 0xa8], eax
0x14045157c: movzx eax, word ptr [rdx + rcx*8]
0x140451580: mov dword ptr [rbx + 0xb4], eax
0x140451586: movzx eax, word ptr [rdx + rcx*8 + 4]
0x14045158b: mov dword ptr [rbx + 0xb8], eax
0x140451591: movzx eax, word ptr [rdx + rcx*8 + 6]
0x140451596: mov dword ptr [rbx + 0xa4], eax
0x14045159c: xor eax, eax
0x14045159e: mov qword ptr [rbx + 0x90], rdi
0x1404515a5: mov dword ptr [rbx + 0x84], edi
0x1404515ab: mov dword ptr [rbx + 0x9c], edi
0x1404515b1: mov dword ptr [rbx + 0x70], edi
0x1404515b4: mov rdi, qword ptr [rsp + 0x30]
0x1404515b9: mov dword ptr [rbx + 0xa0], 2
0x1404515c3: mov dword ptr [rbx + 0x88], 2
0x1404515cd: add rsp, 0x20
0x1404515d1: pop rbx
0x1404515d2: ret 
0x1404515d3: mov eax, 0xfffffffe
0x1404515d8: add rsp, 0x20
0x1404515dc: pop rbx
0x1404515dd: ret 
0x1404515de: int3 
0x1404515df: int3 
0x1404515e0: int3 
0x1404515e1: int3 
0x1404515e2: int3 
0x1404515e3: int3 
0x1404515e4: int3 
0x1404515e5: int3 
0x1404515e6: int3 
0x1404515e7: int3 
0x1404515e8: int3 
0x1404515e9: int3 
0x1404515ea: int3 
0x1404515eb: int3 
0x1404515ec: int3 
0x1404515ed: int3 
0x1404515ee: int3 
0x1404515ef: int3 
