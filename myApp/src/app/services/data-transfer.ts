import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';


@Injectable({
  providedIn: 'root',
})
export class DataTransfer {
  constructor(private http: HttpClient) {}

sendData(data: any) {

  const serverIp = localStorage.getItem('serverIp');

  if (!serverIp) {
    throw new Error('Server IP not set');
  }

  const url = `http://${serverIp}/barcode-template/scan`;

  return this.http.post(url, data);
}
  
}
